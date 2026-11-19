import { useQueryClient } from '@tanstack/react-query';
import { isManagerRole, type Member, type MemberRole } from '@delegate/shared';
import { Copy, Plus, RefreshCw, UserMinus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useToast } from '../components/Toast';
import { Avatar, Button, Card, Input, Modal, Select, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { PageHeader } from './AppShell';
import { useWorkspace } from './data';
import { departmentOptions, roleOptions } from './options';

const roleLabel: Record<MemberRole, string> = { owner: 'Owner', manager: 'Manager', member: 'Staff' };
const PALETTE = ['#6E56CF', '#0EA5A4', '#D9480F', '#2B7FFF', '#2F9E6A', '#B4232A', '#8A5A00'];

export default function TeamPage() {
  const { data: ws, isLoading } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [deptName, setDeptName] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  if (isLoading || !ws) return <Spinner className="m-8" />;
  const isManager = isManagerRole(ws.me.role);
  const isOwner = ws.me.role === 'owner';
  const owner = ws.members.find((m) => m.role === 'owner');
  const refresh = () => qc.invalidateQueries({ queryKey: ['workspace'] });

  const patchMember = async (userId: string, patch: Record<string, unknown>) => {
    try {
      await api.patch(`/members/${userId}`, patch);
      await refresh();
      toast.success('Team updated');
    } catch (e) {
      toast.error(e);
    }
  };

  // Owners can remove anyone but themselves; managers can remove staff.
  const canRemove = (m: Member) => isManager && m.userId !== ws.me.userId && m.role !== 'owner' && (m.role !== 'manager' || isOwner);
  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      const r = await api.del<{ tasksHandedOver: number }>(`/members/${removing.userId}`);
      await qc.invalidateQueries();
      toast.success(r.tasksHandedOver ? `${removing.fullName} removed · ${r.tasksHandedOver} task(s) now assigned to you` : `${removing.fullName} removed from the workspace`);
      setRemoving(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setRemoveBusy(false);
    }
  };

  const regenerate = async () => {
    try {
      await api.patch('/workspace', { regenerateInvite: true });
      await refresh();
      toast.success('New invite code generated — the old one no longer works');
    } catch (e) {
      toast.error(e);
    }
  };

  const addDept = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/departments', { name: deptName, color: PALETTE[ws.departments.length % PALETTE.length] });
      setDeptName('');
      await refresh();
      toast.success('Department added');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Team" subtitle={`${ws.members.length} people in ${ws.org.name}`} />
      <Modal open={!!removing} onClose={() => !removeBusy && setRemoving(null)} title={`Remove ${removing?.fullName ?? ''}?`} description="For when someone has left the company or the team.">
        <ul className="space-y-2 rounded-2xl bg-milk p-4 text-sm text-ink-2">
          <li>• They lose access to {ws.org.name} straight away.</li>
          <li>• Their unfinished tasks and playbook duties are assigned to you, so you can pass them on.</li>
          <li>• Their past work and comments stay in the history. They keep their own sign-in and can be invited back.</li>
        </ul>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setRemoving(null)} disabled={removeBusy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove} loading={removeBusy} data-testid="confirm-remove-member">
            Remove from workspace
          </Button>
        </div>
      </Modal>
      <div className="grid gap-4 px-4 pb-12 sm:px-8 xl:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line" data-testid="member-list">
            {ws.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Avatar name={m.fullName} src={m.avatarUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.fullName} {m.userId === ws.me.userId && <span className="text-faint">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-mute">
                    {m.email} · joined {timeAgo(m.joinedAt)}
                  </p>
                </div>
                {isManager ? (
                  <Select
                    size="sm"
                    align="end"
                    value={m.departmentId ?? ''}
                    onChange={(v) => patchMember(m.userId, { departmentId: v || null })}
                    options={departmentOptions(ws.departments, { value: '', label: 'No department' })}
                    aria-label={`Department for ${m.fullName}`}
                  />
                ) : (
                  <span className="text-sm text-mute">{ws.departments.find((d) => d.id === m.departmentId)?.name ?? '—'}</span>
                )}
                {isOwner && m.role !== 'owner' ? (
                  <Select
                    size="sm"
                    align="end"
                    value={m.role}
                    onChange={(v) => patchMember(m.userId, { role: v })}
                    options={roleOptions.filter((r) => r.value !== 'owner')}
                    aria-label={`Role for ${m.fullName}`}
                  />
                ) : (
                  <span className="rounded-full border border-line px-3 py-1 text-[0.8125rem] text-ink-2">{roleLabel[m.role]}</span>
                )}
                {isManager && (
                  <span className="grid size-9 place-items-center">
                    {canRemove(m) && (
                      <button
                        onClick={() => setRemoving(m)}
                        className="grid size-9 place-items-center rounded-full text-faint transition-colors hover:bg-s-open-soft hover:text-s-open-ink"
                        aria-label={`Remove ${m.fullName} from the workspace`}
                        title="Remove from workspace"
                        data-testid={`remove-member-${m.userId}`}
                      >
                        <UserMinus className="size-4" />
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          {isOwner ? (
            <Card className="p-5">
              <h2 className="text-[0.9375rem] font-medium">Invite your team</h2>
              <p className="mt-1 text-sm text-mute">Teammates sign in (Google or email), then enter this code to join as staff. Only you can see it.</p>
              <div className="mt-4 flex items-center gap-2">
                <code className="flex-1 rounded-xl border border-line bg-milk px-3.5 py-2.5 font-mono text-[0.9375rem] tracking-wider" data-testid="invite-code">
                  {ws.org.inviteCode}
                </code>
                <Button
                  variant="outline"
                  size="md"
                  className="size-11 p-0"
                  aria-label="Copy invite code"
                  onClick={() => navigator.clipboard?.writeText(ws.org.inviteCode).then(() => toast.success('Invite code copied'))}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <button onClick={regenerate} className="mt-3 inline-flex items-center gap-1.5 text-xs text-mute hover:text-ink" data-testid="regenerate-invite">
                <RefreshCw className="size-3.5" /> Generate a new code
              </button>
            </Card>
          ) : (
            <Card className="p-5" data-testid="invite-owner-only">
              <h2 className="text-[0.9375rem] font-medium">Adding someone?</h2>
              <p className="mt-1 text-sm text-mute">
                Only the workspace owner{owner ? <>, <span className="font-medium text-ink">{owner.fullName}</span>,</> : ''} can invite people. Ask them to share the invite code.
              </p>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-[0.9375rem] font-medium">Departments</h2>
            <p className="mt-1 text-sm text-mute">Swimlanes for filtering the board without losing the global rhythm.</p>
            <ul className="mt-4 space-y-2">
              {ws.departments.map((d) => (
                <li key={d.id} className="flex items-center gap-2.5 text-sm">
                  <span className="size-2.5 rounded-full" style={{ background: d.color }} />
                  {d.name}
                  <span className="ml-auto text-xs text-faint">{ws.members.filter((m) => m.departmentId === d.id).length} people</span>
                </li>
              ))}
            </ul>
            {isManager && (
              <form onSubmit={addDept} className="mt-4 flex gap-2">
                <Input value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="New department" required minLength={2} maxLength={40} className="h-10" />
                <Button type="submit" variant="outline" className="h-10 shrink-0" loading={busy}>
                  <Plus className="size-4" /> Add
                </Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
