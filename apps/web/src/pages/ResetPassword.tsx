import { KeyRound } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { MIN_PASSWORD, PasswordInput } from '../components/PasswordInput';
import { useToast } from '../components/Toast';
import { Button, EASE, FullPageSpinner, Logo } from '../components/ui';
import { useAuth } from '../lib/auth';

/**
 * The "reset your password" email lands here. The link signs you in for this one purpose
 * (?code=… exchanged by supabase-js, or ?token_hash=…&type=recovery verified below); then you choose
 * a new password and go straight to your board.
 */
export default function ResetPassword() {
  const { config, token, me, verifyEmailLink, updatePassword } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const verifying = useRef(false);

  useEffect(() => {
    document.title = 'Choose a new password · Delegate';
    const id = setTimeout(() => setExpired(true), 10_000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const tokenHash = q.get('token_hash');
    if (!tokenHash || !config || verifying.current) return;
    verifying.current = true;
    verifyEmailLink(tokenHash, q.get('type') ?? 'recovery').catch((e: Error) => setError(e.message));
  }, [config, verifyEmailLink]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    try {
      await updatePassword(password);
      toast.success('Password updated — you’re signed in');
      navigate(me?.membership ? '/app' : '/onboarding', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the password.');
      setBusy(false);
    }
  };

  if (!config) return <FullPageSpinner />;
  const waiting = !token && !error && !expired;

  return (
    <div className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
      <Link to="/" aria-label="Delegate home" className="self-start">
        <Logo />
      </Link>
      <motion.div className="mx-auto my-auto w-full max-w-[400px] py-12" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
        <span className="grid size-12 place-items-center rounded-2xl border border-line bg-paper">
          <KeyRound className="size-5" />
        </span>
        <h1 className="mt-5 text-[2.2rem] font-medium leading-none tracking-display">Choose a new password</h1>

        {waiting ? (
          <p className="mt-4 text-sm text-mute">Checking your reset link…</p>
        ) : !token ? (
          <div className="mt-5 rounded-2xl border border-s-open/30 bg-s-open-soft px-4 py-3 text-sm text-s-open-ink" role="alert" data-testid="reset-problem">
            {error ?? 'This reset link has expired, was already used, or was opened in a different browser. Request a new one.'}
            <Link to="/login?mode=forgot" className="mt-2 block font-medium underline underline-offset-4">
              Send me a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={save} className="mt-6 space-y-3" data-testid="reset-form">
            <p className="text-sm text-mute">For {me?.profile.email ?? 'your account'}. You’ll stay signed in on this device.</p>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-ink-2">New password</span>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD} characters`} autoComplete="new-password" required meter autoFocus data-testid="reset-password" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] font-medium text-ink-2">Type it again</span>
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required data-testid="reset-confirm" />
            </label>
            {error && (
              <p className="rounded-2xl border border-s-open/30 bg-s-open-soft px-4 py-3 text-sm text-s-open-ink" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" loading={busy} data-testid="reset-save">
              Save and continue
            </Button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
