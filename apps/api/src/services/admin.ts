import { TASK_STATUSES, type AdminOrgRow, type AdminOverview, type AdminUserRow, type LedgerEvent } from '@delegate/shared';
import { notFound } from '../lib/errors.js';
import type { Store } from '../store/types.js';

/** Platform-operator views across every tenant. Only reachable with an admin token. */
export class AdminService {
  constructor(private store: Store) {}

  async overview(): Promise<AdminOverview> {
    const [orgs, profiles, byStatus, events24h] = await Promise.all([
      this.store.listOrgs(),
      this.store.listProfiles(),
      this.store.countTasksByStatus(),
      this.store.countEventsSince(new Date(Date.now() - 86_400_000).toISOString()),
    ]);
    const days = 14;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const signupsDaily = Array.from({ length: days }, (_, i) => {
      const start = today.getTime() - (days - 1 - i) * 86_400_000;
      return {
        date: new Date(start).toISOString().slice(0, 10),
        count: profiles.filter((p) => {
          const ts = new Date(p.createdAt).getTime();
          return ts >= start && ts < start + 86_400_000;
        }).length,
      };
    });
    return {
      totals: {
        organizations: orgs.length,
        users: profiles.length,
        tasks: TASK_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        events24h,
        suspendedOrgs: orgs.filter((o) => o.status === 'suspended').length,
      },
      byStatus,
      signupsDaily,
    };
  }

  async orgs(): Promise<AdminOrgRow[]> {
    const [orgs, stats, subs] = await Promise.all([this.store.listOrgs(), this.store.orgStats(), this.store.listSubscriptions()]);
    const byId = new Map(stats.map((s) => [s.orgId, s]));
    const subById = new Map(subs.map((s) => [s.orgId, s]));
    return orgs
      .map((o) => ({
        ...o,
        plan: subById.get(o.id)?.plan ?? o.plan,
        billingStatus: subById.get(o.id)?.status ?? 'none',
        billingProvider: subById.get(o.id)?.provider ?? null,
        seats: subById.get(o.id)?.seats ?? 0,
        members: byId.get(o.id)?.members ?? 0,
        tasks: byId.get(o.id)?.tasks ?? 0,
        lastActivityAt: byId.get(o.id)?.lastActivityAt ?? null,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async users(): Promise<AdminUserRow[]> {
    const [profiles, memberships, orgs] = await Promise.all([
      this.store.listProfiles(),
      this.store.listMemberships(),
      this.store.listOrgs(),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    return profiles
      .map((p) => {
        const m = memberships.find((x) => x.userId === p.id);
        return { ...p, orgName: m ? (orgName.get(m.orgId) ?? null) : null, role: m?.role ?? null };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setOrgStatus(id: string, status: 'active' | 'suspended') {
    const org = await this.store.getOrg(id);
    if (!org) throw notFound('Workspace not found');
    return this.store.updateOrg(id, { status });
  }

  /** Manual plan override (e.g. an Enterprise contract invoiced outside Stripe/Paystack). */
  async setOrgPlan(id: string, plan: 'starter' | 'team' | 'enterprise') {
    const org = await this.store.getOrg(id);
    if (!org) throw notFound('Workspace not found');
    const current = (await this.store.getSubscription(id)) ?? null;
    await this.store.upsertSubscription({
      orgId: id,
      plan,
      status: plan === 'starter' ? 'none' : 'active',
      provider: plan === 'starter' ? null : 'manual',
      seats: current?.seats ?? 0,
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      providerCustomerId: current?.providerCustomerId ?? null,
      providerSubscriptionId: current?.providerSubscriptionId ?? null,
      updatedAt: new Date().toISOString(),
    });
    return this.store.updateOrg(id, { plan });
  }

  async setUserStatus(id: string, status: 'active' | 'suspended') {
    const p = await this.store.getProfile(id);
    if (!p) throw notFound('User not found');
    await this.store.setProfileStatus(id, status);
  }

  async ledger(limit: number, before?: string): Promise<Array<LedgerEvent & { orgName: string | null; actorName: string | null }>> {
    const [events, orgs, profiles] = await Promise.all([
      this.store.listEvents({ limit, before }),
      this.store.listOrgs(),
      this.store.listProfiles(),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const actor = new Map(profiles.map((p) => [p.id, p.fullName]));
    return events.map((e) => ({
      ...e,
      orgName: orgName.get(e.orgId) ?? null,
      actorName: e.actorId ? (actor.get(e.actorId) ?? null) : null,
    }));
  }
}
