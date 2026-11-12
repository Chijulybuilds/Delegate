import Stripe from 'stripe';
import {
  entitlementsFor,
  TRIAL_DAYS,
  type BillingOverview,
  type BillingProvider,
  type Entitlements,
  type Subscription,
  type SubscriptionStatus,
} from '@delegate/shared';
import type { AppConfig } from '../config.js';
import { hmac, safeEqual } from '../lib/crypto.js';
import { badRequest, HttpError } from '../lib/errors.js';
import type { Store } from '../store/types.js';
import type { Http } from './channels.js';

const DAY = 86_400_000;

export function trialSubscription(orgId: string, now = new Date()): Subscription {
  return {
    orgId,
    plan: 'team',
    status: 'trialing',
    provider: null,
    seats: 0,
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY).toISOString(),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    providerCustomerId: null,
    providerSubscriptionId: null,
    updatedAt: now.toISOString(),
  };
}

const stripeStatus: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
  paused: 'canceled',
};

/**
 * Plans & payments. The source of truth for "is this workspace paying" is the provider webhook
 * (signature-verified, de-duplicated) — never the browser redirect.
 */
export class BillingService {
  private stripe: Stripe | null;

  constructor(
    private store: Store,
    private config: AppConfig,
    private http: Http,
    private onChange: (orgId: string, summary: string) => Promise<void> = async () => {},
  ) {
    this.stripe = config.stripe ? new Stripe(config.stripe.secretKey, { httpClient: Stripe.createFetchHttpClient(http), maxNetworkRetries: 2 }) : null;
  }

  private appUrl() {
    return (this.config.publicAppUrl ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  async subscription(orgId: string): Promise<Subscription> {
    return (await this.store.getSubscription(orgId)) ?? (await this.store.upsertSubscription(trialSubscription(orgId)));
  }

  async entitlements(orgId: string): Promise<Entitlements> {
    return entitlementsFor(await this.subscription(orgId));
  }

  /** Throws 402 when the workspace's current plan lacks a feature. */
  async require(orgId: string, feature: keyof Entitlements['features'], what: string) {
    const ent = await this.entitlements(orgId);
    if (!ent.features[feature]) throw new HttpError(402, `${what} is part of the Team plan. Upgrade in Settings → Billing.`, 'upgrade_required');
    return ent;
  }

  async overview(orgId: string): Promise<BillingOverview> {
    const subscription = await this.subscription(orgId);
    const members = (await this.store.listMemberships(orgId)).length;
    return {
      subscription,
      entitlements: entitlementsFor(subscription),
      members,
      prices: { team: { usd: this.config.prices.teamUsd, ngn: this.config.prices.teamNgn } },
      providers: { stripe: !!this.stripe, paystack: !!this.config.paystack, demoCheckout: this.config.simulateProviders },
    };
  }

  /* ------------------------------------------------------------------------- checkout */

  async checkout(input: { orgId: string; email: string; provider: BillingProvider }): Promise<{ url: string }> {
    const seats = Math.max(1, (await this.store.listMemberships(input.orgId)).length);
    const sub = await this.subscription(input.orgId);
    const back = `${this.appUrl()}/app/settings?tab=billing`;

    if (input.provider === 'stripe' && this.stripe) {
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: this.config.stripe!.priceTeam, quantity: seats }],
        client_reference_id: input.orgId,
        ...(sub.provider === 'stripe' && sub.providerCustomerId ? { customer: sub.providerCustomerId } : { customer_email: input.email }),
        subscription_data: { metadata: { orgId: input.orgId } },
        metadata: { orgId: input.orgId },
        allow_promotion_codes: true,
        success_url: `${back}&checkout=success`,
        cancel_url: `${back}&checkout=cancelled`,
      });
      if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout link', 'provider_error');
      return { url: session.url };
    }

    if (input.provider === 'paystack' && this.config.paystack) {
      const amountKobo = Math.round((this.config.prices.teamNgn ?? 1) * seats * 100);
      const res = await this.paystack<{ authorization_url: string; reference: string }>('POST', '/transaction/initialize', {
        email: input.email,
        amount: amountKobo, // the plan's amount × quantity is what Paystack actually charges
        plan: this.config.paystack.planTeam,
        quantity: seats,
        callback_url: `${back}&checkout=paystack`,
        metadata: { orgId: input.orgId, seats },
      });
      return { url: res.authorization_url };
    }

    if (this.config.simulateProviders) {
      return { url: `/app/settings?tab=billing&demo_checkout=${input.provider}` };
    }
    throw badRequest(`${input.provider === 'stripe' ? 'Stripe' : 'Paystack'} is not configured on this server`);
  }

  /** Demo workspace only: completes a simulated checkout so the full flow can be explored. */
  async completeDemoCheckout(orgId: string, provider: BillingProvider) {
    if (!this.config.simulateProviders) throw new HttpError(404, 'Not found', 'not_found');
    const seats = Math.max(1, (await this.store.listMemberships(orgId)).length);
    await this.save(orgId, {
      plan: 'team',
      status: 'active',
      provider,
      seats,
      trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() + 30 * DAY).toISOString(),
      providerCustomerId: `demo_cus_${orgId.slice(0, 8)}`,
      providerSubscriptionId: `demo_sub_${orgId.slice(0, 8)}`,
      cancelAtPeriodEnd: false,
    });
    return this.overview(orgId);
  }

  async portal(orgId: string): Promise<{ url: string }> {
    const sub = await this.subscription(orgId);
    if (sub.provider === 'stripe' && this.stripe && sub.providerCustomerId) {
      const session = await this.stripe.billingPortal.sessions.create({ customer: sub.providerCustomerId, return_url: `${this.appUrl()}/app/settings?tab=billing` });
      return { url: session.url };
    }
    if (sub.provider === 'paystack' && this.config.paystack && sub.providerSubscriptionId) {
      const res = await this.paystack<{ link: string }>('GET', `/subscription/${encodeURIComponent(sub.providerSubscriptionId)}/manage/link`);
      return { url: res.link };
    }
    throw badRequest('There is no paid subscription to manage yet');
  }

  /** Keeps Stripe seat quantity equal to the number of members (prorated by Stripe). */
  async syncSeats(orgId: string) {
    try {
      const sub = await this.store.getSubscription(orgId);
      if (!sub || sub.provider !== 'stripe' || !this.stripe || !sub.providerSubscriptionId || sub.status !== 'active') return;
      const seats = Math.max(1, (await this.store.listMemberships(orgId)).length);
      if (seats === sub.seats) return;
      const remote = await this.stripe.subscriptions.retrieve(sub.providerSubscriptionId);
      const item = remote.items.data[0];
      if (!item) return;
      await this.stripe.subscriptions.update(sub.providerSubscriptionId, { items: [{ id: item.id, quantity: seats }], proration_behavior: 'create_prorations' });
      await this.save(orgId, { seats });
    } catch (error) {
      console.error('[billing] seat sync failed', error);
    }
  }

  /* ------------------------------------------------------------------------- webhooks */

  /** Stripe: signature checked by the SDK (Stripe-Signature, 5-minute tolerance). */
  async handleStripeWebhook(rawBody: Buffer, signature: string | undefined): Promise<string> {
    if (!this.stripe || !this.config.stripe?.webhookSecret) throw new HttpError(404, 'Stripe webhooks are not configured', 'not_found');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature ?? '', this.config.stripe.webhookSecret);
    } catch {
      throw new HttpError(400, 'Invalid Stripe signature', 'bad_signature');
    }
    // Billing updates are idempotent upserts, so ids are recorded after success: a failed
    // attempt stays retryable, and a replay of a processed event is a harmless no-op.
    const result = await this.applyStripe(event);
    await this.store.recordWebhookEvent('stripe', event.id);
    return result;
  }

  private async applyStripe(event: Stripe.Event): Promise<string> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const orgId = s.client_reference_id ?? s.metadata?.orgId;
        if (!orgId || s.mode !== 'subscription') return 'ignored';
        const current = await this.subscription(orgId);
        await this.save(orgId, {
          plan: 'team',
          provider: 'stripe',
          status: current.provider === 'stripe' && current.status !== 'trialing' ? current.status : 'active',
          trialEndsAt: null,
          providerCustomerId: typeof s.customer === 'string' ? s.customer : (s.customer?.id ?? null),
          providerSubscriptionId: typeof s.subscription === 'string' ? s.subscription : (s.subscription?.id ?? null),
        });
        return 'activated';
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const s = event.data.object as Stripe.Subscription;
        const customerId = typeof s.customer === 'string' ? s.customer : s.customer.id;
        const orgId =
          s.metadata?.orgId ?? (await this.store.findSubscription('subscription', s.id))?.orgId ?? (await this.store.findSubscription('customer', customerId))?.orgId;
        if (!orgId) return 'unknown_org';
        const item = s.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
        const periodEnd = (s as unknown as { current_period_end?: number }).current_period_end ?? item?.current_period_end ?? null;
        await this.save(orgId, {
          plan: 'team',
          provider: 'stripe',
          status: event.type === 'customer.subscription.deleted' ? 'canceled' : (stripeStatus[s.status] ?? 'incomplete'),
          seats: item?.quantity ?? 1,
          trialEndsAt: null,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          cancelAtPeriodEnd: !!s.cancel_at_period_end,
          providerCustomerId: customerId,
          providerSubscriptionId: s.id,
        });
        return 'synced';
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id;
        const sub = customerId ? await this.store.findSubscription('customer', customerId) : null;
        if (!sub) return 'unknown_org';
        await this.save(sub.orgId, { status: 'past_due' });
        return 'past_due';
      }
      default:
        return 'ignored';
    }
  }

  /** Paystack: x-paystack-signature = HMAC-SHA512(raw body, secret key), hex. */
  async handlePaystackWebhook(rawBody: Buffer, signature: string | undefined): Promise<string> {
    if (!this.config.paystack) throw new HttpError(404, 'Paystack webhooks are not configured', 'not_found');
    if (!signature || !safeEqual(hmac('sha512', this.config.paystack.secretKey, rawBody), signature)) {
      throw new HttpError(400, 'Invalid Paystack signature', 'bad_signature');
    }
    const event = JSON.parse(rawBody.toString('utf8')) as { event: string; data: Record<string, any> };
    const d = event.data ?? {};
    const id = `${event.event}:${d.id ?? d.reference ?? d.subscription_code ?? d.invoice_code ?? ''}`;
    const result = await this.applyPaystack(event.event, d);
    // Paystack may send subscription.create before charge.success links the customer: ask it to retry.
    if (result === 'unknown_org' && event.event.startsWith('subscription.')) throw new HttpError(409, 'Workspace not linked yet; retry later', 'retry');
    await this.store.recordWebhookEvent('paystack', id);
    return result;
  }

  /** Redirect fallback: confirms a transaction straight from Paystack so the UI updates instantly. */
  async verifyPaystack(orgId: string, reference: string) {
    if (!this.config.paystack) throw badRequest('Paystack is not configured');
    const tx = await this.paystack<Record<string, any>>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const meta = parseMeta(tx.metadata);
    if (tx.status === 'success' && meta.orgId === orgId) await this.applyPaystack('charge.success', tx);
    return this.overview(orgId);
  }

  private async applyPaystack(type: string, d: Record<string, any>): Promise<string> {
    const customerCode: string | undefined = d.customer?.customer_code;
    const meta = parseMeta(d.metadata);
    const byCustomer = customerCode ? await this.store.findSubscription('customer', customerCode) : null;
    const orgId: string | undefined = meta.orgId ?? byCustomer?.orgId;
    if (!orgId) return 'unknown_org';

    switch (type) {
      case 'charge.success': {
        if (!d.plan && !meta.orgId) return 'ignored'; // not a Delegate subscription payment
        await this.save(orgId, {
          plan: 'team',
          provider: 'paystack',
          status: 'active',
          trialEndsAt: null,
          seats: Number(meta.seats ?? byCustomer?.seats ?? 1),
          providerCustomerId: customerCode ?? byCustomer?.providerCustomerId ?? null,
          currentPeriodEnd: byCustomer?.currentPeriodEnd ?? new Date(Date.now() + 30 * DAY).toISOString(),
        });
        return 'activated';
      }
      case 'subscription.create':
        await this.save(orgId, {
          plan: 'team',
          provider: 'paystack',
          status: d.status === 'active' ? 'active' : 'incomplete',
          providerSubscriptionId: d.subscription_code ?? null,
          providerCustomerId: customerCode ?? null,
          currentPeriodEnd: d.next_payment_date ? new Date(d.next_payment_date).toISOString() : null,
          cancelAtPeriodEnd: false,
        });
        return 'synced';
      case 'subscription.not_renew':
        await this.save(orgId, { cancelAtPeriodEnd: true });
        return 'not_renewing';
      case 'subscription.disable':
        await this.save(orgId, { status: 'canceled', cancelAtPeriodEnd: false });
        return 'canceled';
      case 'invoice.payment_failed':
        await this.save(orgId, { status: 'past_due' });
        return 'past_due';
      case 'invoice.update':
        if (d.paid) await this.save(orgId, { status: 'active', currentPeriodEnd: d.subscription?.next_payment_date ?? null });
        return 'synced';
      default:
        return 'ignored';
    }
  }

  private async paystack<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.http(`https://api.paystack.co${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.config.paystack!.secretKey}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
    if (!res.ok || !json.status || !json.data) throw new HttpError(502, `Paystack: ${json.message ?? `HTTP ${res.status}`}`, 'provider_error');
    return json.data;
  }

  private async save(orgId: string, patch: Partial<Subscription>) {
    const current = await this.subscription(orgId);
    const next: Subscription = { ...current, ...patch, orgId, updatedAt: new Date().toISOString() };
    await this.store.upsertSubscription(next);
    if (current.status !== next.status || current.plan !== next.plan || current.seats !== next.seats) {
      await this.store.appendEvent({
        orgId,
        taskId: null,
        actorId: null,
        type: 'billing.updated',
        fromStatus: null,
        toStatus: null,
        meta: { plan: next.plan, status: next.status, provider: next.provider, seats: next.seats },
      });
      await this.onChange(orgId, `Plan: ${next.plan} · ${next.status.replace('_', ' ')}`);
    }
  }
}

function parseMeta(meta: unknown): Record<string, any> {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta) as Record<string, any>;
    } catch {
      return {};
    }
  }
  return meta as Record<string, any>;
}
