import { useQueryClient } from '@tanstack/react-query';
import { isManagerRole, type MemberRole } from '@delegate/shared';
import { Copy, Plus, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useToast } from '../components/Toast';
import { Avatar, Button, Card, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { PageHeader } from './AppShell';
import { useWorkspace } from './data';

const roleLabel: Record<MemberRole, string> = { owner: 'Owner', manager: 'Manager', member: 'Staff' };
const PALETTE = ['#6E56CF', '#0EA5A4', '#D9480F', '#2B7FFF', '#2F9E6A', '#B4232A', '#8A5A00'];

export default function TeamPage() {
  const { data: ws, isLoading } = useWorkspace();
  const qc = useQueryClient();
  const toast = useToast();
  const [deptName, setDeptName] = useState('');
  const [busy, setBusy] = useState(false);

  if (isLoading || !ws) return <Spinner className="m-8" />;
  const isManager = isManagerRole(ws.me.role);
  const isOwner = ws.me.role === 'owner';
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
                  <select
                    className="h-9 rounded-full border border-line bg-paper px-3 text-[13px]"
                    value={m.departmentId ?? ''}
                    onChange={(e) => patchMember(m.userId, { departmentId: e.target.value || null })}
                    aria-label={`Department for ${m.fullName}`}
                  >
                    <option value="">No department</option>
                    {ws.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-mute">{ws.departments.find((d) => d.id === m.departmentId)?.name ?? '—'}</span>
                )}
                {isOwner && m.role !== 'owner' ? (
                  <select
                    className="h-9 rounded-full border border-line bg-paper px-3 text-[13px]"
                    value={m.role}
                    onChange={(e) => patchMember(m.userId, { role: e.target.value })}
                    aria-label={`Role for ${m.fullName}`}
                  >
                    <option value="member">Staff</option>
                    <option value="manager">Manager</option>
                  </select>
                ) : (
                  <span className="rounded-full border border-line px-3 py-1 text-[13px] text-ink-2">{roleLabel[m.role]}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-[15px] font-medium">Invite your team</h2>
            <p className="mt-1 text-sm text-mute">Teammates sign in with Google, then enter this code to join as staff.</p>
            <div className="mt-4 flex items-center gap-2">
              <code className="flex-1 rounded-xl border border-line bg-milk px-3.5 py-2.5 font-mono text-[15px] tracking-wider" data-testid="invite-code">
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
            {isManager && (
              <button onClick={regenerate} className="mt-3 inline-flex items-center gap-1.5 text-xs text-mute hover:text-ink">
                <RefreshCw className="size-3.5" /> Generate a new code
              </button>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-[15px] font-medium">Departments</h2>
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
