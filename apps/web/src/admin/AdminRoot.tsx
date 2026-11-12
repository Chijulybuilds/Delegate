import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminOrgRow, AdminOverview, AdminUserRow, LedgerEvent } from '@delegate/shared';
import { LogOut, Search, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ColumnChart, StackedBar, StatTile } from '../components/charts';
import { useToast } from '../components/Toast';
import { Avatar, Button, Card, cx, EASE, Input, LogoMark, Segmented, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { clock, timeAgo } from '../lib/format';

/**
 * Platform operator console. Reached only by typing /admin — no link exists anywhere in the
 * product. Uses its own credentials and its own short-lived token (sessionStorage, 8h), fully
 * separate from customer Google sign-in.
 */

const TOKEN_KEY = 'delegate.adminToken';
const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (t: string | null) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = 'Console · Delegate';
    return () => {
      meta.remove();
      document.title = prevTitle;
    };
  }, []);
}

export default function AdminRoot() {
  useNoIndex();
  const [token, setToken] = useState<string | null>(readToken);
  const qc = useQueryClient();

  const session = useQuery({
    queryKey: ['admin', 'session', token],
    queryFn: () => api.get<{ email: string }>('/admin/session', token),
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      writeToken(null);
      setToken(null);
    }
  }, [session.error]);

  const signOut = () => {
    writeToken(null);
    setToken(null);
    qc.removeQueries({ queryKey: ['admin'] });
  };

  if (!token) {
    return (
      <AdminLogin
        onSuccess={(t) => {
          writeToken(t);
          setToken(t);
        }}
      />
    );
  }
  if (session.isLoading || !session.data) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#0f0f0f]">
        <Spinner className="text-white/50" />
      </div>
    );
  }
  return <AdminConsole token={token} email={session.data.email} onSignOut={signOut} />;
}

function AdminLogin({ onSuccess }: { onSuccess: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string }>('/admin/login', { email, password }, null);
      onSuccess(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-[#0f0f0f] px-5 text-white">
      <motion.div className="w-full max-w-sm" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
        <div className="flex items-center gap-2.5 text-white">
          <LogoMark className="size-8 text-white [--color-milk:#0f0f0f]" />
          <span className="text-lg font-semibold tracking-[-0.03em]">Delegate Console</span>
        </div>
        <p className="mt-2 text-sm text-white/50">Restricted. Platform operators only. Activity is logged.</p>
        <form onSubmit={submit} className="mt-8 space-y-4" data-testid="admin-login">
          <label className="block space-y-1.5">
            <span className="text-[13px] text-white/70">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              className="h-11 w-full rounded-xl border border-white/15 bg-white/5 px-3.5 text-sm text-white outline-none transition focus:border-white/60"
              data-testid="admin-email"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[13px] text-white/70">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="h-11 w-full rounded-xl border border-white/15 bg-white/5 px-3.5 text-sm text-white outline-none transition focus:border-white/60"
              data-testid="admin-password"
            />
          </label>
          {error && (
            <p className="rounded-xl border border-[#ff8a8a]/30 bg-[#ff8a8a]/10 px-3 py-2 text-sm text-[#ffb3b3]" role="alert" data-testid="admin-error">
              {error}
            </p>
          )}
          <Button type="submit" variant="soft" size="lg" className="w-full border-white bg-white text-ink" loading={busy} data-testid="admin-submit">
            Sign in to console
          </Button>
        </form>
      </motion.div>
    </div>
  );
}

type Tab = 'overview' | 'orgs' | 'users' | 'ledger';

function AdminConsole({ token, email, onSignOut }: { token: string; email: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="min-h-dvh bg-milk">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0f0f0f] text-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-8">
          <LogoMark className="size-7 text-white [--color-milk:#0f0f0f]" />
          <span className="font-semibold tracking-[-0.03em]">Console</span>
          <span className="hidden items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/60 sm:inline-flex">
            <ShieldCheck className="size-3.5" /> Platform admin
          </span>
          <span className="ml-auto hidden text-sm text-white/60 sm:inline" data-testid="admin-email-display">
            {email}
          </span>
          <button onClick={onSignOut} className="grid size-9 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white" aria-label="Sign out of console" data-testid="admin-signout">
            <LogOut className="size-4" />
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'orgs', label: 'Workspaces' },
            { value: 'users', label: 'Users' },
            { value: 'ledger', label: 'Ledger' },
          ]}
        />
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className="mt-6">
          {tab === 'overview' && <Overview token={token} />}
          {tab === 'orgs' && <Orgs token={token} />}
          {tab === 'users' && <Users token={token} />}
          {tab === 'ledger' && <Ledger token={token} />}
        </motion.div>
      </div>
    </div>
  );
}

function Overview({ token }: { token: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<AdminOverview>('/admin/overview', token), refetchInterval: 15_000 });
  if (isLoading || !data) return <Spinner />;
  return (
    <div className="space-y-4" data-testid="admin-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Workspaces" value={data.totals.organizations} testId="admin-kpi-orgs" />
        <StatTile label="Users" value={data.totals.users} testId="admin-kpi-users" />
        <StatTile label="Tasks" value={data.totals.tasks} />
        <StatTile label="Ledger events · 24h" value={data.totals.events24h} />
        <StatTile label="Suspended workspaces" value={data.totals.suspendedOrgs} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-[15px] font-medium">Tasks by state</h2>
          <p className="text-xs text-faint">Across every workspace</p>
          <div className="mt-6">
            <StackedBar
              title="Tasks by state"
              segments={[
                { label: 'Open', value: data.byStatus.open, color: '#E5484D' },
                { label: 'In progress', value: data.byStatus.in_progress, color: '#E8A317' },
                { label: 'Blocked', value: data.byStatus.blocked, color: '#E8A317', textured: true },
                { label: 'Executed', value: data.byStatus.done, color: '#2F9E6A' },
                { label: 'Audited', value: data.byStatus.approved, color: '#2B7FFF' },
              ]}
            />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-[15px] font-medium">New users per day</h2>
          <p className="text-xs text-faint">Last 14 days</p>
          <div className="mt-6">
            <ColumnChart
              title="New users per day"
              unit="sign-ups"
              height={150}
              emptyText="No new sign-ups in the last 14 days"
              data={data.signupsDaily.map((d) => {
                const date = new Date(`${d.date}T00:00:00Z`);
                return {
                  label: date.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' }),
                  tooltipLabel: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
                  value: d.count,
                };
              })}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Orgs({ token }: { token: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'orgs'], queryFn: () => api.get<{ orgs: AdminOrgRow[] }>('/admin/orgs', token) });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; plan?: string }) => api.patch(`/admin/orgs/${id}`, body, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success('Workspace updated');
    },
    onError: (e) => toast.error(e),
  });
  if (isLoading || !data) return <Spinner />;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm" data-testid="admin-orgs">
        <thead>
          <tr className="border-b border-line text-left text-xs text-faint">
            <th className="px-5 py-3 font-normal">Workspace</th>
            <th className="py-3 font-normal">Plan</th>
            <th className="py-3 font-normal">Billing</th>
            <th className="py-3 text-right font-normal">Members</th>
            <th className="py-3 text-right font-normal">Tasks</th>
            <th className="py-3 pl-6 font-normal">Last activity</th>
            <th className="py-3 font-normal">Status</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody>
          {data.orgs.map((o) => (
            <tr key={o.id} className="border-b border-line last:border-0">
              <td className="px-5 py-3.5">
                <p className="font-medium">{o.name}</p>
                <p className="text-xs text-faint">
                  {o.slug} · created {timeAgo(o.createdAt)}
                </p>
              </td>
              <td className="py-3.5">
                <select className="h-8 rounded-full border border-line bg-paper px-2.5 text-[13px] capitalize" value={o.plan} onChange={(e) => patch.mutate({ id: o.id, plan: e.target.value })} aria-label={`Plan for ${o.name}`}>
                  {['starter', 'team', 'enterprise'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-3.5 text-[13px]" data-testid={`org-billing-${o.slug}`}>
                <span className="capitalize">{o.billingStatus === 'none' ? 'Free' : o.billingStatus.replace('_', ' ')}</span>
                <span className="block text-xs text-faint">
                  {o.billingProvider ? (o.billingProvider === 'manual' ? 'Manual' : o.billingProvider === 'stripe' ? 'Stripe' : 'Paystack') : '—'}
                  {o.seats ? ` · ${o.seats} seat${o.seats === 1 ? '' : 's'}` : ''}
                </span>
              </td>
              <td className="py-3.5 text-right tabular-nums">{o.members}</td>
              <td className="py-3.5 text-right tabular-nums">{o.tasks}</td>
              <td className="py-3.5 pl-6 text-mute">{o.lastActivityAt ? timeAgo(o.lastActivityAt) : '—'}</td>
              <td className="py-3.5">
                <span className={cx('rounded-full px-2.5 py-1 text-xs', o.status === 'active' ? 'bg-s-done-soft text-[#1E6B47]' : 'bg-s-open-soft text-[#B4232A]')}>{o.status}</span>
              </td>
              <td className="px-5 py-3.5 text-right">
                <Button
                  size="sm"
                  variant={o.status === 'active' ? 'outline' : 'primary'}
                  onClick={() => patch.mutate({ id: o.id, status: o.status === 'active' ? 'suspended' : 'active' })}
                  data-testid={`org-toggle-${o.slug}`}
                >
                  {o.status === 'active' ? 'Suspend' : 'Reactivate'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Users({ token }: { token: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'users'], queryFn: () => api.get<{ users: AdminUserRow[] }>('/admin/users', token) });
  const patch = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/admin/users/${id}`, { status }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('User updated');
    },
    onError: (e) => toast.error(e),
  });
  const rows = useMemo(
    () => (data?.users ?? []).filter((u) => !q || `${u.fullName} ${u.email} ${u.orgName ?? ''}`.toLowerCase().includes(q.toLowerCase())),
    [data, q],
  );
  if (isLoading || !data) return <Spinner />;
  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or workspace" className="pl-10" aria-label="Search users" />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm" data-testid="admin-users">
          <thead>
            <tr className="border-b border-line text-left text-xs text-faint">
              <th className="px-5 py-3 font-normal">User</th>
              <th className="py-3 font-normal">Workspace</th>
              <th className="py-3 font-normal">Role</th>
              <th className="py-3 font-normal">Joined</th>
              <th className="py-3 font-normal">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3">
                  <span className="flex items-center gap-2.5">
                    <Avatar name={u.fullName} src={u.avatarUrl} size={28} />
                    <span>
                      <span className="block font-medium">{u.fullName}</span>
                      <span className="block text-xs text-faint">{u.email}</span>
                    </span>
                  </span>
                </td>
                <td className="py-3 text-ink-2">{u.orgName ?? <span className="text-faint">No workspace</span>}</td>
                <td className="py-3 capitalize text-ink-2">{u.role ?? '—'}</td>
                <td className="py-3 text-mute">{timeAgo(u.createdAt)}</td>
                <td className="py-3">
                  <span className={cx('rounded-full px-2.5 py-1 text-xs', u.status === 'active' ? 'bg-s-done-soft text-[#1E6B47]' : 'bg-s-open-soft text-[#B4232A]')}>{u.status}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  <Button size="sm" variant="ghost" onClick={() => patch.mutate({ id: u.id, status: u.status === 'active' ? 'suspended' : 'active' })}>
                    {u.status === 'active' ? 'Suspend' : 'Restore'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Ledger({ token }: { token: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'ledger'],
    queryFn: () => api.get<{ events: Array<LedgerEvent & { orgName: string | null; actorName: string | null }> }>('/admin/ledger?limit=150', token),
    refetchInterval: 10_000,
  });
  if (isLoading || !data) return <Spinner />;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm" data-testid="admin-ledger">
        <thead>
          <tr className="border-b border-line text-left text-xs text-faint">
            <th className="px-5 py-3 font-normal">#</th>
            <th className="py-3 font-normal">When</th>
            <th className="py-3 font-normal">Workspace</th>
            <th className="py-3 font-normal">Actor</th>
            <th className="py-3 font-normal">Event</th>
            <th className="px-5 py-3 font-normal">Task</th>
          </tr>
        </thead>
        <tbody>
          {data.events.map((e) => (
            <tr key={`${e.id}-${e.createdAt}`} className="border-b border-line last:border-0">
              <td className="px-5 py-2.5 font-mono text-xs text-faint">{e.id}</td>
              <td className="py-2.5 whitespace-nowrap text-mute">
                {new Date(e.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {clock(e.createdAt)}
              </td>
              <td className="py-2.5">{e.orgName ?? '—'}</td>
              <td className="py-2.5">{e.actorName ?? '—'}</td>
              <td className="py-2.5">
                <code className="rounded bg-milk px-1.5 py-0.5 font-mono text-xs">{e.type}</code>
                {e.toStatus && <span className="ml-2 text-xs text-faint">→ {e.toStatus.replace('_', ' ')}</span>}
              </td>
              <td className="max-w-[280px] truncate px-5 py-2.5 text-ink-2">{typeof e.meta.title === 'string' ? e.meta.title : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

