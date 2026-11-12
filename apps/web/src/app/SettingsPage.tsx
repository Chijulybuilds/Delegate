import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useToast } from '../components/Toast';
import { Avatar, Button, Card, Field, Input, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from './AppShell';
import { useWorkspace } from './data';

export default function SettingsPage() {
  const { data: ws, isLoading } = useWorkspace();
  const { me, signOut, config } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading || !ws || !me) return <Spinner className="m-8" />;
  const isOwner = ws.me.role === 'owner';
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [ws.org.timezone];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/workspace', { ...(name !== null ? { name } : {}), ...(timezone !== null ? { timezone } : {}) });
      await qc.invalidateQueries({ queryKey: ['workspace'] });
      toast.success('Workspace saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid max-w-4xl gap-4 px-4 pb-12 sm:px-8 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-[15px] font-medium">Workspace</h2>
          <form onSubmit={save} className="mt-5 space-y-4">
            <Field label="Name">
              <Input value={name ?? ws.org.name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} minLength={2} maxLength={60} />
            </Field>
            <Field label="Time zone" hint="Standup days and due times follow this zone.">
              <select
                className="h-11 w-full rounded-xl border border-line bg-paper px-3.5 text-sm"
                value={timezone ?? ws.org.timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={ws.me.role === 'member'}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-faint">
              Plan: <span className="font-medium capitalize text-ink-2">{ws.org.plan}</span>
            </p>
            {ws.me.role !== 'member' && (
              <Button type="submit" loading={busy} disabled={name === null && timezone === null}>
                Save changes
              </Button>
            )}
          </form>
        </Card>
        <Card className="p-6">
          <h2 className="text-[15px] font-medium">Your account</h2>
          <div className="mt-5 flex items-center gap-3">
            <Avatar name={me.profile.fullName} src={me.profile.avatarUrl} size={48} />
            <div>
              <p className="font-medium">{me.profile.fullName}</p>
              <p className="text-sm text-mute">{me.profile.email}</p>
            </div>
          </div>
          <p className="mt-5 text-sm text-mute">
            Signed in with {config?.authMode === 'supabase' ? 'Google' : 'a demo session'}. Profile details come from your Google account.
          </p>
          <Button variant="outline" className="mt-5" onClick={() => signOut()}>
            Sign out
          </Button>
        </Card>
      </div>
    </div>
  );
}
