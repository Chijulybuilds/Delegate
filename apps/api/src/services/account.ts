import { isManagerRole, type LeavePlan, type Member } from '@delegate/shared';
import { forbidden, HttpError, notFound } from '../lib/errors.js';
import type { Store } from '../store/types.js';
import type { BillingService } from './billing.js';

/**
 * Leaving a workspace and deleting an account.
 *
 *   leave   → unfinished tasks (and playbook duties) go to the owner, the person loses access.
 *             An owner first hands ownership to someone else.
 *   delete  → leave, then erase the person: name, email, photo and WhatsApp number are wiped and
 *             their sign-in is removed. Past work stays in the workspace, shown as "Deleted user",
 *             because the activity history is a permanent record the company relies on.
 *             A sole owner deletes the workspace with them (never while a paid plan is running).
 *   remove  → a manager takes someone who has left the company off the workspace; their unfinished
 *             work goes to that manager. Owners can remove anyone else, managers only staff.
 */

const fail = (status: number, code: string, message: string) => new HttpError(status, message, code);

export class AccountService {
  constructor(
    private store: Store,
    private billing: BillingService,
  ) {}

  /** What leaving / deleting would do, so the app can explain it before anyone clicks. */
  async plan(userId: string): Promise<LeavePlan | null> {
    const m = await this.store.getMembershipForUser(userId);
    if (!m) return null;
    const [org, members, tasks, sub] = await Promise.all([
      this.store.getOrg(m.orgId),
      this.store.listMembers(m.orgId),
      this.store.listTasks({ orgId: m.orgId, statuses: ['open', 'in_progress', 'blocked'] }),
      this.billing.subscription(m.orgId),
    ]);
    const others = members.filter((x) => x.userId !== userId).length;
    return {
      role: m.role,
      orgName: org?.name ?? 'your workspace',
      others,
      openTasks: tasks.filter((t) => t.assigneeId === userId).length,
      deletesWorkspace: others === 0,
      paidPlanActive: (sub.provider === 'stripe' || sub.provider === 'paystack') && ['active', 'trialing', 'past_due'].includes(sub.status) && !sub.cancelAtPeriodEnd,
    };
  }

  async leave(userId: string, opts: { newOwnerId?: string } = {}) {
    const m = await this.store.getMembershipForUser(userId);
    if (!m) throw notFound('You are not in a workspace');
    const members = await this.store.listMembers(m.orgId);
    const others = members.filter((x) => x.userId !== userId);
    if (others.length === 0) {
      throw fail(400, 'last_member', 'You’re the only person in this workspace. Delete your account instead; that also deletes the workspace.');
    }

    let heir = members.find((x) => x.role === 'owner' && x.userId !== userId) ?? null;
    if (m.role === 'owner') {
      const next = others.find((x) => x.userId === opts.newOwnerId);
      if (!next) throw fail(400, 'new_owner_required', 'Choose who will own the workspace after you leave.');
      await this.store.updateMember(m.orgId, next.userId, { role: 'owner' });
      await this.store.appendEvent({ orgId: m.orgId, taskId: null, actorId: userId, type: 'member.role_changed', fromStatus: null, toStatus: null, meta: { userId: next.userId, name: next.fullName, from: next.role, to: 'owner', reason: 'ownership_transferred', actorName: members.find((x) => x.userId === userId)?.fullName } });
      heir = { ...next, role: 'owner' };
    }
    heir ??= others.find((x) => isManagerRole(x.role)) ?? others[0]!;
    const me = members.find((x) => x.userId === userId)!;
    const handed = await this.handOver(m.orgId, me, heir, userId, 'member_left');
    return { orgId: m.orgId, handedTo: heir.userId, tasksHandedOver: handed };
  }

  /** A manager removes someone who has left (they may never sign in again to click "Leave"). */
  async remove(actorId: string, orgId: string, targetId: string) {
    if (actorId === targetId) throw fail(400, 'use_leave', 'To leave the workspace yourself, use Settings → Account → Leave workspace.');
    const members = await this.store.listMembers(orgId);
    const actor = members.find((x) => x.userId === actorId);
    const target = members.find((x) => x.userId === targetId);
    if (!actor || !isManagerRole(actor.role)) throw forbidden('Only managers can remove people');
    if (!target) throw notFound('That person is not in this workspace');
    if (target.role === 'owner') throw forbidden('The owner can’t be removed. They can hand over ownership and leave from their own account.');
    if (target.role === 'manager' && actor.role !== 'owner') throw forbidden('Only the owner can remove a manager');
    const handed = await this.handOver(orgId, target, actor, actorId, 'member_removed');
    return { handedTo: actor.userId, tasksHandedOver: handed };
  }

  /** Moves someone's unfinished tasks and playbook duties to `heir`, then takes them off the workspace. */
  private async handOver(orgId: string, leaver: Member, heir: Member, actorId: string, reason: 'member_left' | 'member_removed') {
    // Names travel with the events: people who've left are no longer in the member list.
    const names = { name: leaver.fullName, toName: heir.fullName, actorName: reason === 'member_left' ? leaver.fullName : heir.fullName };
    // Hand over unfinished work so nothing is left assigned to someone who's gone.
    const unfinished = (await this.store.listTasks({ orgId, statuses: ['open', 'in_progress', 'blocked'] })).filter((t) => t.assigneeId === leaver.userId);
    for (const t of unfinished) {
      await this.store.updateTask(t.id, { assigneeId: heir.userId });
      await this.store.appendEvent({ orgId, taskId: t.id, actorId, type: 'task.updated', fromStatus: t.status, toStatus: t.status, meta: { title: t.title, reassigned: { from: leaver.userId, to: heir.userId }, ...names, reason } });
    }
    for (const pb of await this.store.listPlaybooks(orgId)) {
      if (!pb.items.some((i) => i.assigneeId === leaver.userId)) continue;
      await this.store.savePlaybook({ ...pb, items: pb.items.map((i) => (i.assigneeId === leaver.userId ? { ...i, assigneeId: heir.userId } : i)) });
    }

    await this.store.removeMember(orgId, leaver.userId);
    await this.store.appendEvent({ orgId, taskId: null, actorId, type: 'member.left', fromStatus: null, toStatus: null, meta: { userId: leaver.userId, handedTo: heir.userId, ...names, tasks: unfinished.length, reason } });
    await this.billing.syncSeats(orgId); // fewer people → fewer paid seats
    return unfinished.length;
  }

  async deleteAccount(userId: string, opts: { newOwnerId?: string; deleteWorkspace?: boolean } = {}) {
    const plan = await this.plan(userId);
    if (plan?.deletesWorkspace) {
      if (plan.paidPlanActive) {
        throw fail(409, 'subscription_active', 'Cancel your Team subscription first (Settings → Billing → Manage subscription), then delete your account.');
      }
      if (!opts.deleteWorkspace) throw fail(400, 'confirm_workspace_deletion', `This also deletes “${plan.orgName}” and everything in it. Confirm to continue.`);
      const m = (await this.store.getMembershipForUser(userId))!;
      await this.store.deleteOrg(m.orgId);
    } else if (plan) {
      await this.leave(userId, { newOwnerId: opts.newOwnerId });
    }
    await this.store.eraseUser(userId);
    return { deletedWorkspace: !!plan?.deletesWorkspace };
  }
}
