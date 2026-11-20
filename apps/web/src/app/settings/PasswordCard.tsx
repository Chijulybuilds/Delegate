import { Check, KeyRound, Mail } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { CodeInput } from '../../components/CodeInput';
import { MIN_PASSWORD, PasswordInput } from '../../components/PasswordInput';
import { useToast } from '../../components/Toast';
import { Button, Card, cx, EASE, Field, Spinner } from '../../components/ui';
import { AuthUiError, useAuth } from '../../lib/auth';

/**
 * Settings → Account → Password. Someone who signed up with Google can add a password here and from
 * then on log in either way (Google, or their email + password). People with a password can change
 * it. When Supabase wants proof it's really them (an older session with "Secure password change"
 * on), we email a code and they type it in, the same way sign-up works.
 */

type Methods = { email: string; google: boolean; password: boolean };
type Step = 'idle' | 'form' | 'code';
const RESEND_AFTER = 60;

export function PasswordCard() {
  const { config, signInMethods, updatePassword, sendReauthCode } = useAuth();
  const toast = useToast();
  const [methods, setMethods] = useState<Methods | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const supabase = config?.authMode === 'supabase';

  useEffect(() => {
    if (!supabase) return;
    signInMethods()
      .then(setMethods)
      .catch(() => setLoadError(true));
  }, [supabase, signInMethods]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  if (!supabase) {
    return (
      <Card className="p-6" data-testid="password-card">
        <Title />
        <p className="mt-3 text-sm text-mute">Demo accounts sign in without a password.</p>
      </Card>
    );
  }

  const reset = () => {
    setStep('idle');
    setPassword('');
    setConfirm('');
    setCode('');
    setError(null);
    setBusy(false);
  };

  const done = async () => {
    const had = methods?.password;
    reset();
    toast.success(had ? 'Password changed' : 'Password set — you can now also log in with your email and password');
    setMethods(await signInMethods().catch(() => (methods ? { ...methods, password: true } : null)));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    try {
      await updatePassword(password);
      await done();
    } catch (err) {
      if (err instanceof AuthUiError && err.code === 'reauthentication_needed') {
        // Supabase wants proof: email a code, then finish with it.
        try {
          await sendReauthCode();
          setStep('code');
          setCooldown(RESEND_AFTER);
          setError(null);
        } catch (sendErr) {
          setError(sendErr instanceof Error ? sendErr.message : 'We couldn’t send the code. Try again in a minute.');
        }
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      }
      setBusy(false);
    }
  };

  const confirmWithCode = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password, value);
      await done();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn’t work.');
      setShake((n) => n + 1);
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await sendReauthCode();
      setCooldown(RESEND_AFTER);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn’t send the code.');
      if (err instanceof AuthUiError && err.retryAfter) setCooldown(err.retryAfter);
    }
  };

  const hasPassword = !!methods?.password;

  return (
    <Card className="p-6" data-testid="password-card">
      <Title />
      {!methods ? (
        loadError ? <p className="mt-3 text-sm text-mute">Couldn’t load your sign-in methods. Refresh to try again.</p> : <Spinner className="mt-4" />
      ) : (
        <>
          {/* How you can log in today */}
          <div className="mt-4 flex flex-wrap gap-2" data-testid="signin-methods">
            {methods.google && <Method on label="Google" icon={<GoogleMark />} />}
            <Method on={hasPassword} label="Email & password" icon={<Mail className="size-3.5" />} />
          </div>
          <p className="mt-3 text-sm text-mute">
            {hasPassword ? (
              <>
                You can log in with <span className="font-medium text-ink">{methods.email}</span> and your password{methods.google ? ', or with Google' : ''}.
              </>
            ) : (
              <>
                You sign in with Google. Add a password to also log in with <span className="font-medium text-ink">{methods.email}</span> and a password — handy on a new or shared device.
              </>
            )}
          </p>

          <AnimatePresence mode="wait" initial={false}>
            {step === 'idle' && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <Button variant={hasPassword ? 'outline' : 'primary'} className="mt-5" onClick={() => setStep('form')} data-testid="password-start">
                  <KeyRound className="size-4" /> {hasPassword ? 'Change password' : 'Set a password'}
                </Button>
              </motion.div>
            )}

            {step === 'form' && (
              <motion.form
                key="form"
                onSubmit={save}
                noValidate
                className="mt-5 space-y-3"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25, ease: EASE }}
                data-testid="password-form"
              >
                <Field label={hasPassword ? 'New password' : 'Password'} htmlFor="new-password">
                  <PasswordInput id="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} meter autoFocus data-testid="password-new" />
                </Field>
                <Field label="Type it again" htmlFor="confirm-password">
                  <PasswordInput id="confirm-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" data-testid="password-confirm" />
                </Field>
                <Problem text={error} />
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="submit" loading={busy} data-testid="password-save">
                    {hasPassword ? 'Change password' : 'Set password'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </motion.form>
            )}

            {step === 'code' && (
              <motion.div key="code" className="mt-5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} data-testid="password-code">
                <p className="text-sm">
                  To keep your account safe, type the {config?.emailOtpLength ?? 6}-digit code we just emailed to <span className="font-medium">{methods.email}</span>.
                </p>
                <div className="mt-4 flex justify-start">
                  <CodeInput length={config?.emailOtpLength ?? 6} value={code} onChange={setCode} onComplete={confirmWithCode} disabled={busy} state={error ? 'error' : 'idle'} shake={shake} autoFocus data-testid="password-code-input" />
                </div>
                <Problem text={error} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => confirmWithCode(code)} disabled={code.length < (config?.emailOtpLength ?? 6)} loading={busy} data-testid="password-code-confirm">
                    Confirm
                  </Button>
                  <Button variant="outline" size="sm" disabled={cooldown > 0} onClick={resend}>
                    {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </Card>
  );
}

function Title() {
  return (
    <div className="flex items-center gap-2">
      <KeyRound className="size-[18px]" />
      <h2 className="text-[0.9375rem] font-medium">Password</h2>
    </div>
  );
}

function Method({ on, label, icon }: { on: boolean; label: string; icon: React.ReactNode }) {
  return (
    <span
      className={cx('inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[0.8125rem]', on ? 'border-s-done/40 bg-s-done-soft text-s-done-ink' : 'border-dashed border-line-2 text-mute')}
      data-on={on}
      data-testid={`method-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
    >
      {icon}
      {label}
      {on ? <Check className="size-3.5" /> : <span className="text-[0.75rem]">· not set</span>}
    </span>
  );
}

function Problem({ text }: { text: string | null }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-xl bg-s-open-soft px-3 py-2 text-sm text-s-open-ink" role="alert" data-testid="password-error">
          {text}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
