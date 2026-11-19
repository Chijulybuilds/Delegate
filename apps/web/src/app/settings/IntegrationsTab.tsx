import { useQueryClient } from '@tanstack/react-query';
import { CHANNEL_EVENTS, isManagerRole, type ChannelEvent, type IntegrationProvider, type IntegrationSummary } from '@delegate/shared';
import { Copy, Github, HardDrive, Hash, MessageCircle, Send, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useToast } from '../../components/Toast';
import { Button, Card, cx, Field, Input, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { timeAgo } from '../../lib/format';
import { useIntegrations, type WorkspaceData } from '../data';

const EVENT_LABELS: Record<ChannelEvent, string> = {
  assigned: 'New assignments',
  blocked: 'Blockers',
  submitted: 'Proof submitted',
  approved: 'Audits',
  escalated: 'Escalations & overdue',
  digest: '8 AM brief',
};

export function IntegrationsTab({ ws }: { ws: WorkspaceData }) {
  const { data, isLoading } = useIntegrations();
  const { config } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const canManage = isManagerRole(ws.me.role);

  useEffect(() => {
    const connected = params.get('connected');
    const error = params.get('error');
    if (!connected && !error) return;
    if (connected) toast.success(`${connected === 'slack' ? 'Slack' : connected} connected`);
    if (error) toast.error(error === 'slack_in_use' ? 'That Slack workspace is connected to another Delegate workspace' : `Could not connect (${error})`);
    setParams({ tab: 'integrations' }, { replace: true });
  }, [params, setParams, toast]);

  if (isLoading || !data) return <Spinner />;
  const get = (p: IntegrationProvider) => data.integrations.find((i) => i.provider === p)!;
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      const out = await fn();
      await refresh();
      if (ok) toast.success(ok);
      return out;
    } catch (e) {
      toast.error(e);
      return null;
    }
  };

  return (
    <div className="max-w-5xl space-y-4" data-testid="integrations">
      {!canManage && <p className="rounded-2xl border border-line bg-paper px-4 py-3 text-sm text-mute">Only managers can connect tools. You can link your own WhatsApp under Account.</p>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SlackCard s={get('slack')} canManage={canManage} run={run} />
        <TeamsCard s={get('teams')} canManage={canManage} run={run} />
        <WhatsAppCard s={get('whatsapp')} canManage={canManage} run={run} teamPlan={ws.entitlements.features.whatsapp} simulator={!!config?.integrations.whatsapp.simulator} />
        <GitHubCard s={get('github')} canManage={canManage} run={run} autoProof={ws.entitlements.features.autoProof} />
        <DriveCard s={get('gdrive')} />
      </div>

      {canManage && (
        <Card className="overflow-hidden">
          <div className="px-5 pb-3 pt-5">
            <h2 className="text-[0.9375rem] font-medium">Recent deliveries</h2>
            <p className="text-xs text-faint">Every message sent to Slack, Teams, WhatsApp and email — useful when something didn't arrive.</p>
          </div>
          {data.deliveries.length === 0 ? (
            <p className="border-t border-line px-5 py-6 text-sm text-faint">Nothing sent yet. Connect a channel and assign a task.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm" data-testid="deliveries">
                <tbody>
                  {data.deliveries.map((d) => (
                    <tr key={d.id} className="border-t border-line">
                      <td className="px-5 py-2.5 capitalize text-ink-2">{d.channel}</td>
                      <td className="py-2.5 text-mute">{d.target}</td>
                      <td className="max-w-[280px] truncate py-2.5">{d.summary}</td>
                      <td className="py-2.5">
                        <span
                          className={cx(
                            'rounded-full px-2 py-0.5 text-xs',
                            d.status === 'sent' ? 'bg-s-done-soft text-s-done-ink' : d.status === 'failed' ? 'bg-s-open-soft text-s-open-ink' : 'bg-milk text-mute',
                          )}
                          title={d.error ?? undefined}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-right text-xs text-faint">{timeAgo(d.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<unknown>;

function Shell({ icon, title, blurb, s, children, testId }: { icon: ReactNode; title: string; blurb: string; s: IntegrationSummary; children: ReactNode; testId: string }) {
  return (
    <Card className="flex flex-col p-5" data-testid={testId}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-milk">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[0.9375rem] font-medium">{title}</h3>
            <span className={cx('rounded-full px-2 py-0.5 text-[0.6875rem] font-medium', s.connected ? 'bg-s-done-soft text-s-done-ink' : 'bg-milk text-mute')} data-testid={`${testId}-status`}>
              {s.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-mute">{blurb}</p>
        </div>
      </div>
      {s.lastError && s.connected && <p className="mt-3 rounded-xl bg-s-open-soft px-3 py-2 text-xs text-s-open-ink">Last error: {s.lastError}</p>}
      <div className="mt-4 flex-1 space-y-3 text-sm">{children}</div>
    </Card>
  );
}

function Events({ s, canManage, run }: { s: IntegrationSummary; canManage: boolean; run: Run }) {
  const toggle = (e: ChannelEvent) => {
    const next = s.events.includes(e) ? s.events.filter((x) => x !== e) : [...s.events, e];
    return run(() => api.patch(`/integrations/${s.provider}/events`, { events: next }));
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHANNEL_EVENTS.map((e) => (
        <button
          key={e}
          disabled={!canManage}
          onClick={() => toggle(e)}
          className={cx('rounded-full border px-2.5 py-1 text-xs transition-colors', s.events.includes(e) ? 'border-ink bg-ink text-milk' : 'border-line bg-paper text-mute hover:border-line-2')}
        >
          {EVENT_LABELS[e]}
        </button>
      ))}
    </div>
  );
}

function Footer({ s, canManage, run, test = true }: { s: IntegrationSummary; canManage: boolean; run: Run; test?: boolean }) {
  if (!s.connected || !canManage) return null;
  return (
    <div className="flex gap-2 border-t border-line pt-3">
      {test && (
        <Button size="sm" variant="outline" onClick={() => run(() => api.post(`/integrations/${s.provider}/test`), 'Test message sent — check the channel')} data-testid={`${s.provider}-test`}>
          <Send className="size-3.5" /> Send test
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => confirm('Disconnect? Messages stop immediately.') && run(() => api.del(`/integrations/${s.provider}`), 'Disconnected')}>
        Disconnect
      </Button>
    </div>
  );
}

function SlackCard({ s, canManage, run }: { s: IntegrationSummary; canManage: boolean; run: Run }) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const install = async () => {
    setBusy(true);
    const res = (await run(() => api.post<{ url: string }>('/integrations/slack/install'))) as { url: string } | null;
    if (res?.url) {
      if (res.url.startsWith('/')) navigate(res.url, { replace: true });
      else window.location.assign(res.url);
    }
    setBusy(false);
  };
  return (
    <Shell icon={<Hash className="size-5" />} title="Slack" blurb="Post updates to a channel. Create tasks with /delegate or from any message." s={s} testId="slack">
      {s.connected ? (
        <>
          <p className="text-mute">
            {String(s.details.teamName ?? 'Slack')} → <span className="font-medium text-ink">{String(s.details.channel ?? 'no channel')}</span>
          </p>
          <Events s={s} canManage={canManage} run={run} />
          <p className="rounded-xl bg-milk px-3 py-2 font-mono text-xs text-ink-2">/delegate new Renew SSL cert @tunde tomorrow !high</p>
        </>
      ) : canManage ? (
        <Button onClick={install} loading={busy} disabled={!s.details.platformReady} data-testid="slack-connect">
          Add to Slack
        </Button>
      ) : null}
      {!s.details.platformReady && <p className="text-xs text-faint">The server needs SLACK_CLIENT_ID, SLACK_CLIENT_SECRET and SLACK_SIGNING_SECRET.</p>}
      <Footer s={s} canManage={canManage} run={run} />
    </Shell>
  );
}

function TeamsCard({ s, canManage, run }: { s: IntegrationSummary; canManage: boolean; run: Run }) {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [token, setToken] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await run(() => api.post('/integrations/teams', { ...(webhookUrl ? { webhookUrl } : {}), ...(token ? { outgoingToken: token } : {}) }), 'Microsoft Teams saved');
    setWebhookUrl('');
    setToken('');
  };
  return (
    <Shell icon={<Users className="size-5" />} title="Microsoft Teams" blurb="Adaptive Cards in a channel, and “@Delegate new …” to create tasks." s={s} testId="teams">
      {s.connected && (
        <>
          <p className="text-mute">
            Channel cards: <span className="font-medium text-ink">{s.details.notifications ? 'on' : 'off'}</span> · @Delegate commands:{' '}
            <span className="font-medium text-ink">{s.details.commands ? 'on' : 'off'}</span>
          </p>
          <Events s={s} canManage={canManage} run={run} />
          {s.details.outgoingUrl && <CopyRow label="Outgoing webhook callback URL" value={String(s.details.outgoingUrl)} />}
        </>
      )}
      {canManage && (
        <details className="group rounded-xl border border-line" open={!s.connected}>
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium">{s.connected ? 'Update connection' : 'Connect in two steps'}</summary>
          <form onSubmit={save} className="space-y-3 border-t border-line p-3">
            <ol className="list-decimal space-y-1 pl-4 text-xs text-mute">
              <li>In Teams, open the channel → ⋯ → Workflows → “Post to a channel when a webhook request is received”. Copy the URL.</li>
              <li>Optional, for @Delegate commands: Team → Manage team → Apps → “Create an outgoing webhook”, use the callback URL shown here after saving, then paste the security token.</li>
            </ol>
            <Field label="Workflows webhook URL">
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://…logic.azure.com/workflows/…" className="h-10" data-testid="teams-webhook" />
            </Field>
            <Field label="Outgoing webhook security token (optional)">
              <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Base64 token from Teams" className="h-10" />
            </Field>
            <Button size="sm" type="submit" disabled={!webhookUrl && !token} data-testid="teams-save">
              Save
            </Button>
          </form>
        </details>
      )}
      <Footer s={s} canManage={canManage} run={run} />
    </Shell>
  );
}

function WhatsAppCard({ s, canManage, run, teamPlan, simulator }: { s: IntegrationSummary; canManage: boolean; run: Run; teamPlan: boolean; simulator: boolean }) {
  const [text, setText] = useState('list');
  const [chat, setChat] = useState<Array<{ from: 'me' | 'bot'; text: string }>>([]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const out = (await run(() => api.post<{ reply: string }>('/integrations/whatsapp/simulate', { text }))) as { reply: string } | null;
    if (out) setChat((c) => [...c, { from: 'me' as const, text }, { from: 'bot' as const, text: out.reply }].slice(-8));
  };
  return (
    <Shell icon={<MessageCircle className="size-5" />} title="WhatsApp" blurb="Tasks, blocker pings and the morning brief on WhatsApp. Reply START / DONE / BLOCK." s={s} testId="whatsapp">
      {!teamPlan && <p className="rounded-xl bg-milk px-3 py-2 text-xs text-mute">Part of the Team plan — upgrade under Billing.</p>}
      {s.details.businessNumber && <p className="text-mute">Business number: +{String(s.details.businessNumber)}</p>}
      {canManage && (
        <Button
          size="sm"
          variant={s.connected ? 'ghost' : 'primary'}
          disabled={!teamPlan || !s.details.platformReady}
          onClick={() => run(() => api.post('/integrations/whatsapp', { enabled: !s.connected }), s.connected ? 'WhatsApp switched off' : 'WhatsApp switched on — teammates can link their phones under Account')}
          data-testid="whatsapp-toggle"
        >
          {s.connected ? 'Switch off for this workspace' : 'Switch on for this workspace'}
        </Button>
      )}
      {!s.details.platformReady && <p className="text-xs text-faint">The server needs the WHATSAPP_* keys from Meta.</p>}
      {simulator && s.connected && (
        <div className="rounded-xl border border-line bg-milk p-3" data-testid="whatsapp-simulator">
          <p className="mb-2 text-xs font-medium text-mute">Simulator (demo) — message Delegate as yourself</p>
          <div className="mb-2 max-h-52 space-y-1.5 overflow-y-auto">
            {chat.map((m, i) => (
              <p key={i} className={cx('w-fit max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-1.5 text-xs', m.from === 'me' ? 'ml-auto bg-bubble' : 'bg-paper')} data-testid={m.from === 'bot' ? 'wa-reply' : undefined}>
                {m.text}
              </p>
            ))}
          </div>
          <form onSubmit={send} className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} className="h-9" aria-label="WhatsApp message" data-testid="wa-input" />
            <Button size="sm" type="submit" className="h-9" data-testid="wa-send">
              Send
            </Button>
          </form>
        </div>
      )}
    </Shell>
  );
}

function GitHubCard({ s, canManage, run, autoProof }: { s: IntegrationSummary; canManage: boolean; run: Run; autoProof: boolean }) {
  const [secret, setSecret] = useState<{ webhookUrl: string; secret: string } | null>(null);
  const connect = async () => {
    const out = (await run(() => api.post<{ webhookUrl: string; secret: string }>('/integrations/github'), 'GitHub webhook ready')) as { webhookUrl: string; secret: string } | null;
    if (out) setSecret(out);
  };
  return (
    <Shell icon={<Github className="size-5" />} title="GitHub" blurb="Merged PRs that mention DLG-12 turn the task green with verified proof." s={s} testId="github">
      {!autoProof && <p className="rounded-xl bg-milk px-3 py-2 text-xs text-mute">Auto-proof is part of the Team plan.</p>}
      {s.connected && !secret && (
        <p className="text-mute">
          {s.details.repos ? `Repos: ${String(s.details.repos)}` : 'Waiting for the first delivery'}
          {s.details.lastDeliveryAt ? ` · last ${timeAgo(String(s.details.lastDeliveryAt))}` : ''}
        </p>
      )}
      {secret && (
        <div className="space-y-2 rounded-xl border border-line p-3" data-testid="github-secret">
          <p className="text-xs text-mute">In your repo: Settings → Webhooks → Add webhook. Content type: application/json. Events: Pull requests + Pushes. Copy the secret now — it is shown once.</p>
          <CopyRow label="Payload URL" value={secret.webhookUrl} />
          <CopyRow label="Secret" value={secret.secret} />
        </div>
      )}
      {canManage && (
        <Button size="sm" variant={s.connected ? 'ghost' : 'primary'} onClick={connect} data-testid="github-connect">
          {s.connected ? 'Rotate secret' : 'Create webhook'}
        </Button>
      )}
      <p className="text-xs text-faint">Write “DLG-12” in a PR title, or “fixes DLG-12” in a commit message.</p>
      <Footer s={s} canManage={canManage} run={run} test={false} />
    </Shell>
  );
}

function DriveCard({ s }: { s: IntegrationSummary }) {
  return (
    <Shell icon={<HardDrive className="size-5" />} title="Google Drive" blurb="Attach Docs, Sheets or Slides as proof — verified edited-by and edited-after-start." s={s} testId="gdrive">
      <p className="text-mute">{s.connected ? 'Ready: assignees see “Pick from Google Drive” when submitting proof.' : (s.lastError ?? 'Not configured')}</p>
    </Shell>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div>
      <p className="text-[0.6875rem] uppercase tracking-[0.12em] text-faint">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-milk px-2 py-1.5 font-mono text-xs">{value}</code>
        <button onClick={() => navigator.clipboard?.writeText(value).then(() => toast.success(`${label} copied`))} className="grid size-8 place-items-center rounded-full text-mute hover:bg-ink/5 hover:text-ink" aria-label={`Copy ${label}`}>
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}
