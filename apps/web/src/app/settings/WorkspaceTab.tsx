import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toast';
import { Button, Card, Field, Input } from '../../components/ui';
import { api } from '../../lib/api';
import type { WorkspaceData } from '../data';

export function WorkspaceTab({ ws }: { ws: WorkspaceData }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(ws.org.name);
  const [timezone, setTimezone] = useState(ws.org.timezone);
  const [busy, setBusy] = useState(false);
  const isOwner = ws.me.role === 'owner';
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [ws.org.timezone];

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
          <select className="h-11 w-full rounded-xl border border-line bg-paper px-3.5 text-sm" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={ws.me.role === 'member'}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Invite code" hint="Share it with teammates — manage it on the Team page.">
          <Input value={ws.org.inviteCode} readOnly className="font-mono tracking-wider" />
        </Field>
        {ws.me.role !== 'member' && (
          <Button type="submit" loading={busy}>
            Save changes
          </Button>
        )}
      </form>
    </Card>
  );
}
