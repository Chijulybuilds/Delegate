import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toast';
import { Button, Card, Field, Input, Select, type SelectOption } from '../../components/ui';
import { api } from '../../lib/api';
import type { WorkspaceData } from '../data';

export function WorkspaceTab({ ws }: { ws: WorkspaceData }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(ws.org.name);
  const [timezone, setTimezone] = useState(ws.org.timezone);
  const [busy, setBusy] = useState(false);
  const isOwner = ws.me.role === 'owner';
  const zoneOptions = useMemo<SelectOption[]>(() => {
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [ws.org.timezone];
    const now = new Date();
    return (zones.includes(ws.org.timezone) ? zones : [ws.org.timezone, ...zones]).map((z) => ({
      value: z,
      label: z.replace(/_/g, ' '),
      description: `${now.toLocaleTimeString('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit' })} now`,
    }));
  }, [ws.org.timezone]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/workspace', { ...(isOwner ? { name } : {}), timezone });
      await qc.invalidateQueries({ queryKey: ['workspace'] });
      toast.success('Workspace saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl p-6">
      <h2 className="text-[15px] font-medium">Workspace</h2>
      <form onSubmit={save} className="mt-5 space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} minLength={2} maxLength={60} />
        </Field>
        <Field label="Time zone" hint="Due times, playbooks and the morning brief follow this zone.">
          <Select value={timezone} onChange={setTimezone} options={zoneOptions} disabled={ws.me.role === 'member'} aria-label="Time zone" />
        </Field>
        {isOwner && (
          <Field label="Invite code" hint="Only you can see it. Share it with new teammates; make a new one on the Team page.">
            <Input value={ws.org.inviteCode} readOnly className="font-mono tracking-wider" data-testid="settings-invite-code" />
          </Field>
        )}
        {ws.me.role !== 'member' && (
          <Button type="submit" loading={busy}>
            Save changes
          </Button>
        )}
      </form>
    </Card>
  );
}
