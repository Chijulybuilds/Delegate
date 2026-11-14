import { ArrowLeft, MailCheck, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { CodeInput } from '../components/CodeInput';
import { MIN_PASSWORD, PasswordInput } from '../components/PasswordInput';
import { Button, cx, EASE, Field, Input } from '../components/ui';
import { AuthUiError, useAuth } from '../lib/auth';

type View = 'form' | 'forgot' | 'sent' | 'code';
/** Supabase refuses a second email to the same address within 60 seconds. */
const RESEND_AFTER = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email + password next to "Continue with Google":
 *   sign up  → name, email, password → a 6-digit code by email → type it in → signed in → onboarding
 *              (proves the person really owns the address; Supabase's "Confirm signup" email carries the code)
 *   log in   → email, password (+ "Forgot password?" → reset link by email). An address that was never
 *              confirmed gets a code too.
 */
export function EmailAuth({ signup }: { signup: boolean }) {
  const { signUpWithPassword, signInWithPassword, sendPasswordReset, resendConfirmation, verifyEmailCode, config } = useAuth();
  const codeLength = config?.emailOtpLength ?? 6;
  const [params] = useSearchParams();
  const [view, setView] = useState<View>(params.get('mode') === 'forgot' ? 'forgot' : 'form');
  const [sent, setSent] = useState<{ kind: 'confirm' | 'reset'; email: string } | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<'idle' | 'checking' | 'error' | 'success'>('idle');
  const [shake, setShake] = useState(0);
  const [resent, setResent] = useState(false);

  // Switching between "Get started" and "Log in" starts fresh.
  useEffect(() => {
    setView(params.get('mode') === 'forgot' ? 'forgot' : 'form');
    setError(null);
  }, [signup]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const fail = (e: unknown) => {
    setError(e instanceof AuthUiError ? { message: e.message, code: e.code } : { message: e instanceof Error ? e.message : 'Something went wrong. Please try again.' });
    if (e instanceof AuthUiError && e.retryAfter) setCooldown(e.retryAfter);
    setBusy(false);
  };

  const askForCode = (to: string) => {
    setSent({ kind: 'confirm', email: to });
    setCode('');
    setCodeState('idle');
    setView('code');
    setCooldown(RESEND_AFTER);
  };

  const verify = async (value: string) => {
    if (!sent || codeState === 'checking') return;
    setError(null);
    setCodeState('checking');
    try {
      await verifyEmailCode(sent.email, value);
      setCodeState('success'); // signed in: the sign-in page moves on to onboarding by itself
    } catch (err) {
      setCodeState('error');
      setShake((n) => n + 1);
      fail(err);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Our own checks (styled like every other message) instead of the browser's tooltips.
    if (signup && fullName.trim().length < 2) return setError({ message: 'Enter your full name.' });
    if (!EMAIL.test(email.trim())) return setError({ message: 'Enter a valid work email, like you@company.com.' });
    if (!password) return setError({ message: 'Enter your password.' });
    if (signup && password.length < MIN_PASSWORD) return setError({ message: `Use at least ${MIN_PASSWORD} characters for your password.` });
    setBusy(true);
    try {
      if (signup) {
        const { needsConfirmation } = await signUpWithPassword({ fullName, email: email.trim(), password });
        if (needsConfirmation) {
          askForCode(email.trim());
          setBusy(false);
        }
        // Otherwise a session exists: the sign-in page moves on to onboarding by itself.
      } else {
        await signInWithPassword({ email: email.trim(), password });
      }
    } catch (err) {
      fail(err);
    }
  };

  const forgot = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL.test(email.trim())) return setError({ message: 'Enter a valid work email, like you@company.com.' });
    setBusy(true);
    try {
      await sendPasswordReset(email.trim());
      setSent({ kind: 'reset', email: email.trim() });
      setView('sent');
      setCooldown(RESEND_AFTER);
    } catch (err) {
      fail(err);
    }
    setBusy(false);
  };

  const resend = async (kind: 'confirm' | 'reset', to: string) => {
    setError(null);
    try {
      if (kind === 'confirm') {
        await resendConfirmation(to);
        askForCode(to);
        setResent(true);
      } else {
        await sendPasswordReset(to);
        setSent({ kind, email: to });
        setView('sent');
        setCooldown(RESEND_AFTER);
      }
    } catch (err) {
      // A code went out less than a minute ago: take them to the boxes to type that one in.
      if (kind === 'confirm' && err instanceof AuthUiError && err.code === 'wait' && view !== 'code') {
        askForCode(to);
        setCooldown(err.retryAfter ?? RESEND_AFTER);
        return setError({ message: 'We emailed you a code less than a minute ago. Type that one in.' });
      }
      fail(err);
    }
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={view} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: EASE }}>
        {view === 'form' && (
          <form onSubmit={submit} className="space-y-3" data-testid="email-auth-form" noValidate>
            {signup && (
              <Field label="Full name">
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ada Okafor" required minLength={2} autoComplete="name" data-testid="auth-fullname" />
              </Field>
            )}
            <Field label="Work email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" data-testid="auth-email" />
            </Field>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="auth-password" className="text-[13px] font-medium text-ink-2">
                  {signup ? 'Create a password' : 'Password'}
                </label>
                {!signup && (
                  <button type="button" onClick={() => (setView('forgot'), setError(null))} className="text-[13px] text-mute underline-offset-4 hover:text-ink hover:underline" data-testid="auth-forgot">
                    Forgot password?
                  </button>
                )}
              </div>
              <PasswordInput
                id="auth-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={signup ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
                required
                minLength={signup ? MIN_PASSWORD : undefined}
                autoComplete={signup ? 'new-password' : 'current-password'}
                meter={signup}
                data-testid="auth-password"
              />
            </div>
            <Problem error={error}>
              {error?.code === 'email_not_confirmed' && (
                <button type="button" onClick={() => resend('confirm', email.trim())} className="mt-1 font-medium underline underline-offset-4">
                  Email me a code
                </button>
              )}
              {error?.code === 'user_already_exists' && (
                <button type="button" onClick={() => (setView('forgot'), setError(null))} className="mt-1 font-medium underline underline-offset-4">
                  Reset your password
                </button>
              )}
            </Problem>
            <Button type="submit" size="lg" className="w-full" loading={busy} data-testid="auth-submit">
              {signup ? 'Create account' : 'Log in'}
            </Button>
          </form>
        )}

        {view === 'forgot' && (
          <form onSubmit={forgot} className="space-y-3" data-testid="forgot-form" noValidate>
            <div>
              <p className="font-medium">Reset your password</p>
              <p className="mt-1 text-sm text-mute">Enter your work email and we’ll send you a link to choose a new password.</p>
            </div>
            <Field label="Work email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" autoFocus data-testid="forgot-email" />
            </Field>
            <Problem error={error} />
            <Button type="submit" size="lg" className="w-full" loading={busy} data-testid="forgot-submit">
              Send reset link
            </Button>
            <BackLink onClick={() => (setView('form'), setError(null))}>Back to log in</BackLink>
          </form>
        )}

        {view === 'code' && sent && (
          <div className="rounded-3xl border border-line bg-paper p-6 text-center shadow-[var(--shadow-card)]" data-testid="auth-code">
            <motion.span
              className={cx('mx-auto grid size-14 place-items-center rounded-2xl transition-colors', codeState === 'success' ? 'bg-s-done-soft text-s-done-ink' : 'bg-milk-2 text-ink')}
              initial={{ scale: 0.4, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 16 }}
            >
              {codeState === 'success' ? <ShieldCheck className="size-7" strokeWidth={1.8} /> : <MailCheck className="size-7" strokeWidth={1.8} />}
            </motion.span>
            <p className="mt-4 text-lg font-medium tracking-[-0.02em]">{codeState === 'success' ? 'Email confirmed' : 'Enter your code'}</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-mute">
              {resent ? 'We sent a new' : 'We sent a'} {codeLength}-digit code to <span className="font-medium text-ink">{sent.email}</span>. It works for one hour.
            </p>
            <div className="mt-6">
              <CodeInput
                length={codeLength}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  if (codeState === 'error') setCodeState('idle');
                }}
                onComplete={verify}
                disabled={codeState === 'checking' || codeState === 'success'}
                state={codeState === 'error' ? 'error' : codeState === 'success' ? 'success' : 'idle'}
                shake={shake}
                autoFocus
                data-testid="auth-code-input"
              />
            </div>
            <div className="mt-4">
              <Problem error={error} />
            </div>
            <Button
              size="lg"
              className="mt-4 w-full"
              onClick={() => verify(code)}
              disabled={code.length < codeLength || codeState === 'success'}
              loading={codeState === 'checking'}
              data-testid="auth-code-submit"
            >
              {codeState === 'success' ? 'Signing you in…' : 'Confirm email'}
            </Button>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <MailShortcut email={sent.email} variant="outline" />
              <Button variant="outline" size="sm" disabled={cooldown > 0} onClick={() => resend('confirm', sent.email)} data-testid="auth-resend">
                {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
              </Button>
            </div>
            <p className="mt-3 text-xs text-faint">Not in your inbox? Check spam or promotions. Got a link instead of a code? Tapping it works too.</p>
            <BackLink onClick={() => (setView('form'), setError(null), setResent(false))}>Use a different email</BackLink>
          </div>
        )}

        {view === 'sent' && sent && (
          <div className="rounded-3xl border border-line bg-paper p-6 text-center shadow-[var(--shadow-card)]" data-testid="auth-sent">
            <motion.span
              className="mx-auto grid size-14 place-items-center rounded-2xl bg-s-done-soft text-s-done-ink"
              initial={{ scale: 0.4, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 16 }}
            >
              <MailCheck className="size-7" strokeWidth={1.8} />
            </motion.span>
            <p className="mt-4 text-lg font-medium tracking-[-0.02em]">Check your inbox</p>
            <p className="mt-1.5 text-sm text-mute">
              {sent.kind === 'confirm' ? 'We sent a confirmation link to ' : 'We sent a password reset link to '}
              <span className="font-medium text-ink">{sent.email}</span>.{' '}
              {sent.kind === 'confirm' ? 'Open it to confirm your email and set up your workspace.' : 'Open it to choose a new password.'}
            </p>
            <MailShortcut email={sent.email} />
            <Problem error={error} />
            <div className="mt-4 flex flex-col items-center gap-2">
              <Button variant="outline" size="sm" disabled={cooldown > 0} onClick={() => resend(sent.kind, sent.email)} data-testid="auth-resend">
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
              </Button>
              <p className="text-xs text-faint">Nothing after a few minutes? Check spam, or try again.</p>
            </div>
            <BackLink onClick={() => (setView('form'), setError(null))}>{sent.kind === 'confirm' ? 'Use a different email' : 'Back to log in'}</BackLink>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Problem({ error, children }: { error: { message: string } | null; children?: ReactNode }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
          role="alert"
          data-testid="auth-error"
        >
          <div className="rounded-2xl border border-s-open/30 bg-s-open-soft px-4 py-3 text-left text-sm text-s-open-ink">
            <p>{error.message}</p>
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mx-auto mt-4 flex items-center gap-1.5 text-sm text-mute hover:text-ink">
      <ArrowLeft className="size-4" /> {children}
    </button>
  );
}

/** One-tap link to the inbox for the big webmail providers. */
function MailShortcut({ email, variant = 'primary' }: { email: string; variant?: 'primary' | 'outline' }) {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  const inbox = /gmail\.com|googlemail\.com/.test(domain)
    ? { label: 'Open Gmail', href: 'https://mail.google.com/' }
    : /outlook|hotmail|live\.com|msn\.com/.test(domain)
      ? { label: 'Open Outlook', href: 'https://outlook.live.com/mail/' }
      : /yahoo/.test(domain)
        ? { label: 'Open Yahoo Mail', href: 'https://mail.yahoo.com/' }
        : null;
  if (!inbox) return null;
  return (
    <a href={inbox.href} target="_blank" rel="noreferrer" className={cx('inline-block', variant === 'primary' && 'mt-4')}>
      <Button size="sm" variant={variant} tabIndex={-1}>
        {inbox.label}
      </Button>
    </a>
  );
}
