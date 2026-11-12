import { useQueryClient } from '@tanstack/react-query';
import { isManagerRole } from '@delegate/shared';
import { Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toast';
import { Button, Card, Field, Input } from '../../components/ui';
import { api } from '../../lib/api';
import type { WorkspaceData } from '../data';

export function AutomationsTab({ ws }: { ws: WorkspaceData }) {
  const qc = useQueryClient();
  const toast = useToast();
  const canManage = isManagerRole(ws.me.role);
  const [esc, setEsc] = useState(ws.org.settings.escalation);
  const [digest, setDigest] = useState(ws.org.settings.digest);
  const [busy, setBusy] = useState<string | null>(null);
  const locked = !ws.entitlements.features.escalations;

  const save = async (e: FormEvent, what: 'escalation' | 'digest') => {
    e.preventDefault();
    setBusy(what);
    try {
      await api.patch('/workspace', { settings: what === 'escalation' ? { escalation: esc } : { digest } });
      await qc.invalidateQueries({ queryKey: ['workspace'] });
      toast.success('Automations saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy('run');
    try {
      const r = await api.post<{ escalations: number; overdue: number; playbookRuns: number; digests: number }>('/automations/run');
      await qc.invalidateQueries();
      toast.success(`Checked: ${r.escalations} escalation(s), ${r.overdue} overdue, ${r.playbookRuns} playbook run(s), ${r.digests} brief(s)`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card className="p-6">
        <h2 className="text-[15px] font-medium">Escalation ladder</h2>
        <p className="mt-1 text-sm text-mute">Blocked work climbs automatically, so nothing sits stuck in silence.</p>
        {locked && <p className="mt-3 rounded-xl bg-milk px-3 py-2 text-xs text-mute">Escalations are part of the Team plan.</p>}
        <form onSubmit={(e) => save(e, 'escalation')} className="mt-5 space-y-4" data-testid="escalation-form">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={esc.enabled} onChange={(e) => setEsc({ ...esc, enabled: e.target.checked })} disabled={!canManage || locked} className="size-4 accent-black" />
            Escalate blocked and overdue tasks
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Alert managers after" hint="hours blocked">
              <Input type="number" min={0.5} step={0.5} value={esc.blockedManagerHours} onChange={(e) => setEsc({ ...esc, blockedManagerHours: num(e.target.value) })} disabled={!canManage || locked} />
            </Field>
            <Field label="Alert the owner after" hint="hours blocked">
              <Input type="number" min={1} step={1} value={esc.blockedOwnerHours} onChange={(e) => setEsc({ ...esc, blockedOwnerHours: num(e.target.value) })} disabled={!canManage || locked} />
            </Field>
            <Field label="Overdue alert after" hint="hours past due">
              <Input type="number" min={0} step={0.5} value={esc.overdueHours} onChange={(e) => setEsc({ ...esc, overdueHours: num(e.target.value) })} disabled={!canManage || locked} />
            </Field>
          </div>
          {canManage && (
            <Button type="submit" loading={busy === 'escalation'} disabled={locked}>
              Save
            </Button>
          )}
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="text-[15px] font-medium">Morning brief</h2>
        <p className="mt-1 text-sm text-mute">Yesterday's shipped work, today's tickets and every blocker — to Slack/Teams, WhatsApp and managers' email.</p>
        <form onSubmit={(e) => save(e, 'digest')} className="mt-5 space-y-4">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={digest.enabled} onChange={(e) => setDigest({ ...digest, enabled: e.target.checked })} disabled={!canManage} className="size-4 accent-black" />
            Send the morning brief
          </label>
          <Field label="Send at" hint={`Local time in ${ws.org.timezone}`}>
            <select className="h-11 w-full rounded-xl border border-line bg-paper px-3.5 text-sm" value={digest.hour} onChange={(e) => setDigest({ ...digest, hour: Number(e.target.value) })} disabled={!canManage}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Field>
          {canManage && (
            <Button type="submit" loading={busy === 'digest'}>
              Save
            </Button>
          )}
        </form>
      </Card>

      {canManage && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-6 lg:col-span-2">
          <div>
            <h2 className="text-[15px] font-medium">Run checks now</h2>
            <p className="text-sm text-mute">Automations run every few minutes on their own. Use this to test your settings immediately.</p>
          </div>
          <Button variant="outline" onClick={runNow} loading={busy === 'run'} data-testid="run-automations">
            <Zap className="size-4" /> Run checks now
          </Button>
        </Card>
      )}
    </div>
  );
}
