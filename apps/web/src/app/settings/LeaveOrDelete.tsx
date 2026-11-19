import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeavePlan, Member } from '@delegate/shared';
import { AlertTriangle, ArrowRightLeft, DoorOpen, ShieldAlert, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Select } from '../../components/Select';
import { useToast } from '../../components/Toast';
import { Avatar, Button, Card, EASE, Field, Input, Modal, Spinner, cx } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/**
 * "Danger zone" on the Account tab (and on the onboarding screen for people with no workspace):
 *
 *   Leave workspace → your unfinished tasks go to someone else, you keep your sign-in.
 *   Delete account  → leave, then your name, email, photo, WhatsApp number and sign-in are erased.
 *
 * Both open a dialog that first asks the server what will happen (GET /account/plan) so the person
 * sees the consequences — who gets their tasks, whether the workspace goes too — before confirming.
 */

type Mode = 'leave' | 'delete';
const ROLE = { owner: 'Owner', manager: 'Manager', member: 'Staff' } as const;

export function DangerZone({ members, orgName }: { members: Member[] | null; orgName: string | null }) {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<Mode | null>(null);
  const [flash, setFlash] = useState(false);
  const card = useRef<HTMLDivElement>(null);

  // The avatar menu links here with ?danger=show (scroll to this card), ?danger=delete or ?danger=leave.
  useEffect(() => {
    const d = params.get('danger');
    if (d) {
      if (d === 'delete' || (d === 'leave' && members)) setMode(d);
      card.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1600);
      const next = new URLSearchParams(params);
      next.delete('danger');
      setParams(next, { replace: true });
      return () => clearTimeout(t);
    }
  }, [params, setParams, members]);

  if (!me) return null;
  const alone = !!members && members.length <= 1;

  return (
    <Card ref={card} className={cx('p-6 transition-shadow duration-700 lg:col-span-2', flash && 'ring-2 ring-s-open/60 ring-offset-2 ring-offset-milk')} data-testid="danger-zone">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-[18px] text-s-open-ink" />
        <h2 className="text-[0.9375rem] font-medium">Leave or delete</h2>
      </div>
      <div className="mt-4 divide-y divide-line">
        {members && orgName && (
          <Row
            icon={<DoorOpen className="size-[18px]" />}
            title={`Leave ${orgName}`}
            body={
              alone
                ? 'You’re the only person here, so there’s no one to hand the workspace to. Delete your account instead; that removes the workspace too.'
                : 'For when you move on from the team. Your unfinished tasks are handed over, you lose access to this workspace, and you keep your sign-in to join or create another one.'
            }
            action={
              <Button variant="outline" onClick={() => setMode('leave')} disabled={alone} data-testid="leave-workspace">
                Leave workspace
              </Button>
            }
          />
        )}
        <Row
          icon={<Trash2 className="size-[18px]" />}
          title="Delete my account"
          danger
          body={
            orgName
              ? `Erases your name, email, photo, WhatsApp number and sign-in for good. Work you already did stays in ${orgName}’s history as “Deleted user”, because that record belongs to the company.`
              : 'Erases your name, email, photo, WhatsApp number and sign-in for good. This can’t be undone.'
          }
          action={
            <Button variant="danger" onClick={() => setMode('delete')} data-testid="delete-account">
              Delete account
            </Button>
          }
        />
      </div>
      <LeaveOrDeleteModal mode={mode} onClose={() => setMode(null)} members={members ?? []} />
    </Card>
  );
}

function Row({ icon, title, body, action, danger }: { icon: ReactNode; title: string; body: string; action: ReactNode; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <span className={cx('mt-0.5 grid size-9 shrink-0 place-items-center rounded-full', danger ? 'bg-s-open-soft text-s-open-ink' : 'bg-milk text-ink-2')}>{icon}</span>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 max-w-xl text-sm text-mute">{body}</p>
        </div>
      </div>
      <div className="shrink-0 pl-12 sm:pl-0">{action}</div>
    </div>
  );
}

export function LeaveOrDeleteModal({ mode, onClose, members }: { mode: Mode | null; onClose: () => void; members: Member[] }) {
  const { me, signOut, refreshMe } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [newOwner, setNewOwner] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const open = mode !== null;

  const plan = useQuery({
    queryKey: ['account-plan'],
    queryFn: () => api.get<{ plan: LeavePlan | null }>('/account/plan').then((r) => r.plan),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (open) {
      setTyped('');
      setNewOwner('');
      setBusy(false);
    }
  }, [open, mode]);

  if (!me) return null;
  const p = plan.data ?? null;
  const others = members.filter((m) => m.userId !== me.profile.id);
  const ownerLeaving = p?.role === 'owner' && (p?.others ?? 0) > 0;
  const existingOwner = others.find((m) => m.role === 'owner');
  const heir = ownerLeaving ? others.find((m) => m.userId === newOwner) : (existingOwner ?? others.find((m) => m.role === 'manager') ?? others[0]);
  const blocked = mode === 'delete' && !!p?.deletesWorkspace && p.paidPlanActive;
  const needsTyping = mode === 'delete';
  const ready = !plan.isLoading && !blocked && (!ownerLeaving || !!newOwner) && (!needsTyping || typed.trim().toUpperCase() === 'DELETE');

  const submit = async () => {
    if (!mode || !ready) return;
    setBusy(true);
    try {
      if (mode === 'leave') {
        const r = await api.post<{ tasksHandedOver: number }>('/account/leave', { newOwnerId: newOwner || undefined });
        onClose();
        toast.success(r.tasksHandedOver ? `You left ${p?.orgName}. ${r.tasksHandedOver} task(s) handed over.` : `You left ${p?.orgName}`);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'config' });
        await refreshMe();
        navigate('/onboarding', { replace: true });
      } else {
        await api.post('/account/delete', { newOwnerId: newOwner || undefined, deleteWorkspace: !!p?.deletesWorkspace });
        onClose();
        try {
          await signOut();
        } catch {
          /* the sign-in no longer exists; the local session is cleared either way */
        }
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'config' });
        navigate('/', { replace: true });
        toast.success('Your account has been deleted');
      }
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const title = mode === 'leave' ? `Leave ${p?.orgName ?? 'workspace'}?` : 'Delete your account?';

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={title} description={mode === 'leave' ? 'You can join another workspace afterwards with an invite code.' : 'This can’t be undone.'}>
      {plan.isLoading || !mode ? (
        <div className="grid h-32 place-items-center">
          <Spinner />
        </div>
      ) : plan.isError ? (
        <p className="text-sm text-s-open-ink">Couldn’t check your account. Close this and try again.</p>
      ) : (
        <div className="space-y-5" data-testid="leave-delete-dialog">
          {ownerLeaving && (
            <Field label="Who owns the workspace after you?" hint="They get full control: billing, roles and settings.">
              <Select
                value={newOwner}
                onChange={setNewOwner}
                placeholder="Choose the new owner"
                aria-label="New owner"
                data-testid="new-owner"
                options={others.map((m) => ({ value: m.userId, label: m.fullName, description: `${ROLE[m.role]} · ${m.email}`, icon: <Avatar name={m.fullName} src={m.avatarUrl} size={22} /> }))}
              />
            </Field>
          )}

          <ul className="space-y-2.5 rounded-2xl bg-milk p-4 text-sm">
            {p && !p.deletesWorkspace && (
              <Consequence icon={<ArrowRightLeft className="size-4" />}>
                {p.openTasks === 0 ? (
                  'You have no unfinished tasks to hand over.'
                ) : heir ? (
                  <>
                    Your {p.openTasks} unfinished task{p.openTasks === 1 ? '' : 's'} and playbook duties go to <b className="font-medium text-ink">{heir.fullName}</b>.
                  </>
                ) : (
                  <>Your {p.openTasks} unfinished task{p.openTasks === 1 ? '' : 's'} go to the new owner you choose.</>
                )}
              </Consequence>
            )}
            {p && !p.deletesWorkspace && <Consequence icon={<DoorOpen className="size-4" />}>You lose access to {p.orgName} — your past work and comments stay in its history.</Consequence>}
            {mode === 'delete' && p?.deletesWorkspace && (
              <Consequence icon={<AlertTriangle className="size-4" />} danger>
                You’re the only person in <b className="font-medium">{p.orgName}</b>, so the workspace is deleted too: every task, proof file, comment, playbook and its history.
              </Consequence>
            )}
            {mode === 'delete' && (
              <Consequence icon={<Trash2 className="size-4" />} danger>
                Your name, email, photo and WhatsApp number are erased and you can no longer sign in. {p && !p.deletesWorkspace ? 'Your past work shows as “Deleted user”.' : ''}
              </Consequence>
            )}
          </ul>

          <AnimatePresence>
            {blocked && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="rounded-2xl border border-s-open/30 bg-s-open-soft p-4 text-sm text-s-open-ink">
                {p?.orgName} is on a paid plan. Cancel the subscription first so you aren’t charged again, then come back.{' '}
                <Link to="/app/settings?tab=billing" onClick={onClose} className="font-medium underline underline-offset-4">
                  Go to Billing
                </Link>
              </motion.div>
            )}
          </AnimatePresence>

          {needsTyping && !blocked && (
            <Field label="Type DELETE to confirm" htmlFor="confirm-delete">
              <Input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="DELETE" className="font-mono tracking-wider" data-testid="confirm-delete" />
            </Field>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant={mode === 'delete' ? 'danger' : 'primary'} onClick={submit} disabled={!ready} loading={busy} data-testid="confirm-leave-delete">
              {mode === 'leave' ? 'Leave workspace' : p?.deletesWorkspace ? 'Delete account and workspace' : 'Delete my account'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Consequence({ icon, children, danger }: { icon: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <li className={cx('flex gap-2.5', danger ? 'text-s-open-ink' : 'text-ink-2')}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </li>
  );
}
