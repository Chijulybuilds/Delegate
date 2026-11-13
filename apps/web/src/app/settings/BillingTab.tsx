import { useQueryClient } from '@tanstack/react-query';
import { PLANS } from '@delegate/shared';
import { Check, CreditCard, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useToast } from '../../components/Toast';
import { Button, Card, cx, Modal, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useBilling, type WorkspaceData } from '../data';

const FEATURE_LABELS: Array<[keyof (typeof PLANS)['team']['features'], string]> = [
  ['whatsapp', 'WhatsApp tasks & reminders'],
  ['escalations', 'Escalation alerts'],
  ['autoProof', 'Auto-proof from GitHub'],
  ['aiVerification', 'AI proof checks'],
  ['standupEmail', 'Standup email at 8 AM'],
];

const statusText: Record<string, string> = {
  none: 'Free',
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment failed',
  canceled: 'Canceled',
  incomplete: 'Incomplete',
};

export function BillingTab({ ws }: { ws: WorkspaceData }) {
  const { data, isLoading, refetch } = useBilling();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string | null>(null);
  const demo = params.get('demo_checkout') as 'stripe' | 'paystack' | null;
  const handled = useRef(false);
  const isOwner = ws.me.role === 'owner';

  // Returning from Stripe / Paystack checkout.
  useEffect(() => {
    if (handled.current) return;
    const checkout = params.get('checkout');
    const reference = params.get('reference') ?? params.get('trxref');
    if (checkout === 'success') {
      handled.current = true;
      toast.success('Payment received — your plan updates in a few seconds');
      const id = setInterval(() => refetch(), 2_000);
      setTimeout(() => clearInterval(id), 20_000);
    } else if (checkout === 'paystack' && reference) {
      handled.current = true;
      api
        .post('/billing/paystack/verify', { reference })
        .then(() => Promise.all([refetch(), qc.invalidateQueries({ queryKey: ['workspace'] })]))
        .then(() => toast.success('Paystack payment confirmed'))
        .catch((e) => toast.error(e));
    } else if (checkout === 'cancelled') {
      handled.current = true;
      toast.error('Checkout cancelled — nothing was charged');
    }
  }, [params, refetch, qc, toast]);

  if (isLoading || !data) return <Spinner />;
  const { subscription: sub, entitlements: ent, prices, providers, members } = data;
  const paid = (sub.provider === 'stripe' || sub.provider === 'paystack') && sub.status !== 'canceled';

  const checkout = async (provider: 'stripe' | 'paystack') => {
    setBusy(provider);
    try {
      const { url } = await api.post<{ url: string }>('/billing/checkout', { provider });
      if (url.startsWith('/')) setParams(new URLSearchParams(url.split('?')[1]), { replace: false });
      else window.location.assign(url);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const portal = async () => {
    setBusy('portal');
    try {
      const { url } = await api.post<{ url: string }>('/billing/portal');
      window.location.assign(url);
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };

  const completeDemo = async () => {
    if (!demo) return;
    setBusy('demo');
    try {
      await api.post('/billing/demo-complete', { provider: demo });
      await Promise.all([refetch(), qc.invalidateQueries({ queryKey: ['workspace'] })]);
      toast.success('Team plan active — thank you!');
      setParams({ tab: 'billing' }, { replace: true });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Card className="p-6" data-testid="billing-current">
        <p className="text-xs uppercase tracking-[0.14em] text-faint">Current plan</p>
        <p className="mt-2 text-3xl font-medium tracking-display">
          {ent.effectivePlan === 'starter' ? 'Starter' : PLANS[ent.plan].name}
          <span className={cx('ml-3 align-middle rounded-full px-2.5 py-1 text-xs font-medium', sub.status === 'active' ? 'bg-s-done-soft text-s-done-ink' : sub.status === 'past_due' ? 'bg-s-open-soft text-s-open-ink' : 'bg-milk text-mute')} data-testid="billing-status">
            {statusText[sub.status] ?? sub.status}
          </span>
        </p>
        <dl className="mt-5 space-y-2 text-sm">
          {sub.status === 'trialing' && (
            <Row label="Trial">{ent.trialDaysLeft ? `${ent.trialDaysLeft} day${ent.trialDaysLeft === 1 ? '' : 's'} left` : 'Ended'}</Row>
          )}
          <Row label="Members">
            {members}
            {ent.maxMembers !== null ? ` of ${ent.maxMembers}` : ''}
            {paid && sub.seats ? ` · ${sub.seats} seat${sub.seats === 1 ? '' : 's'} billed` : ''}
          </Row>
          {sub.provider && <Row label="Billed via">{sub.provider === 'manual' ? 'Invoice (manual)' : sub.provider === 'stripe' ? 'Stripe' : 'Paystack'}</Row>}
          {sub.currentPeriodEnd && <Row label={sub.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}>{new Date(sub.currentPeriodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</Row>}
        </dl>
        {paid && isOwner && (
          <Button variant="outline" className="mt-6" onClick={portal} loading={busy === 'portal'}>
            <ExternalLink className="size-4" /> Manage subscription
          </Button>
        )}
        {!isOwner && <p className="mt-6 text-sm text-mute">Only the workspace owner can change the plan.</p>}
      </Card>

      <Card className={cx('p-6', ent.effectivePlan === 'team' && sub.status === 'active' && 'opacity-80')}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-lg font-medium tracking-[-0.02em]">Team</p>
          <p className="text-sm text-mute">
            <span className="text-2xl font-medium tracking-display text-ink">${prices.team.usd}</span> / member / month
            {prices.team.ngn ? <span className="block text-right text-xs">or ₦{prices.team.ngn.toLocaleString()} via Paystack</span> : null}
          </p>
        </div>
        <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          {['Unlimited members', 'Unlimited playbooks', '30-day velocity', ...FEATURE_LABELS.map(([, l]) => l)].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <Check className="size-4 text-ink" strokeWidth={2.2} /> {f}
            </li>
          ))}
        </ul>
        {isOwner && !(sub.status === 'active' && sub.plan !== 'starter') && (
          <div className="mt-6 flex flex-wrap gap-2">
            {(providers.stripe || providers.demoCheckout) && (
              <Button onClick={() => checkout('stripe')} loading={busy === 'stripe'} data-testid="upgrade-stripe">
                <CreditCard className="size-4" /> Upgrade — pay by card
              </Button>
            )}
            {(providers.paystack || providers.demoCheckout) && (
              <Button variant="outline" onClick={() => checkout('paystack')} loading={busy === 'paystack'} data-testid="upgrade-paystack">
                Pay with Paystack (₦, bank, USSD)
              </Button>
            )}
            {!providers.stripe && !providers.paystack && !providers.demoCheckout && <p className="text-sm text-mute">Payments are not configured on this server yet.</p>}
          </div>
        )}
        <p className="mt-4 text-xs text-faint">Seats follow your member count automatically. Cancel anytime from “Manage subscription”.</p>
      </Card>

      <Modal open={!!demo} onClose={() => setParams({ tab: 'billing' }, { replace: true })} title={`Simulated ${demo === 'paystack' ? 'Paystack' : 'Stripe'} checkout`} description="Demo mode: in production this is the provider's secure payment page. No card is charged here.">
        <div className="rounded-2xl border border-line bg-milk p-4 text-sm">
          <p className="font-medium">Delegate Team</p>
          <p className="text-mute">
            {members} member{members === 1 ? '' : 's'} × ${prices.team.usd} / month
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setParams({ tab: 'billing' }, { replace: true })}>
            Cancel
          </Button>
          <Button onClick={completeDemo} loading={busy === 'demo'} data-testid="demo-pay">
            Complete payment
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-mute">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
