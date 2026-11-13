import { useQueryClient } from '@tanstack/react-query';
import { Building2, KeyRound } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useToast } from '../components/Toast';
import { Button, Card, EASE, Field, FullPageSpinner, Input, Logo } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Onboarding() {
  const { booting, token, me, refreshMe, signOut, config } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  useEffect(() => {
    document.title = 'Set up your workspace · Delegate';
  }, []);

  if (booting) return <FullPageSpinner />;
  if (!token || !me) return <Navigate to="/login?intent=signup" replace />;
  if (me.membership) return <Navigate to="/app" replace />;

  const done = async (message: string) => {
    await qc.invalidateQueries();
    await refreshMe();
    toast.success(message);
    navigate('/app', { replace: true });
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('create');
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await api.post('/onboarding/workspace', { name, timezone });
      await done('Workspace created — you are the owner');
    } catch (err) {
      toast.error(err);
      setBusy(null);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('join');
    try {
      await api.post('/onboarding/join', { code });
      await done('You joined the workspace');
    } catch (err) {
      toast.error(err);
      setBusy(null);
    }
  };

  return (
    <div className="min-h-dvh px-5 py-6 sm:px-10">
      <div className="flex items-center justify-between">
        <Logo />
        <button onClick={() => signOut()} className="text-sm text-mute hover:text-ink">
          Sign out
        </button>
      </div>
      <motion.div className="mx-auto max-w-3xl py-14" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
        <h1 className="text-[clamp(2.2rem,5vw,3.4rem)] font-medium leading-[1] tracking-display">
          <span className="text-ink-soft">Hi {me.profile.fullName.split(' ')[0]},</span> let’s get you a board.
        </h1>
        <p className="mt-3 text-[15px] text-mute">Create a workspace for your company, or join your team with the invite code your manager shared.</p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Card className="p-6">
            <span className="grid size-10 place-items-center rounded-full bg-ink text-milk">
              <Building2 className="size-[18px]" />
            </span>
            <h2 className="mt-5 text-lg font-medium tracking-[-0.02em]">Create a workspace</h2>
            <p className="mt-1 text-sm text-mute">You’ll be the owner. Operations, Engineering and Creative departments are set up for you.</p>
            <form onSubmit={create} className="mt-5 space-y-3">
              <Field label="Company or team name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Operations" required minLength={2} maxLength={60} />
              </Field>
              <Button type="submit" className="w-full" loading={busy === 'create'} disabled={!!busy}>
                Create workspace
              </Button>
            </form>
          </Card>
          <Card className="p-6">
            <span className="grid size-10 place-items-center rounded-full border border-line bg-milk">
              <KeyRound className="size-[18px]" />
            </span>
            <h2 className="mt-5 text-lg font-medium tracking-[-0.02em]">Join with an invite code</h2>
            <p className="mt-1 text-sm text-mute">
              Ask your manager for the code on their Team page.
              {config?.authMode === 'demo' && (
                <>
                  {' '}
                  Demo code: <code className="rounded bg-milk px-1.5 py-0.5 font-mono text-[12px] text-ink">LUMEN-2026</code>
                </>
              )}
            </p>
            <form onSubmit={join} className="mt-5 space-y-3">
              <Field label="Invite code">
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ACME-7Q4K" required minLength={4} className="font-mono uppercase tracking-wider" />
              </Field>
              <Button type="submit" variant="outline" className="w-full" loading={busy === 'join'} disabled={!!busy}>
                Join workspace
              </Button>
            </form>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}
