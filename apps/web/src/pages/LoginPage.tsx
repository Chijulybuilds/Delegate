import { useQuery } from '@tanstack/react-query';
import type { MemberRole } from '@delegate/shared';
import { ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useToast } from '../components/Toast';
import { Avatar, Button, cx, EASE, Field, FullPageSpinner, Input, Logo } from '../components/ui';
import { KRAFT, PhotoCup } from '../landing/PhotoCup';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Persona {
  id: string;
  fullName: string;
  role: MemberRole;
  title: string;
  department: string;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const roleLabel: Record<MemberRole, string> = { owner: 'Owner', manager: 'Manager', member: 'Staff' };

export default function LoginPage() {
  const { config, configError, booting, token, me, signInWithGoogle, signInDemo } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const signup = params.get('intent') === 'signup';
  const [busy, setBusy] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    document.title = signup ? 'Create your workspace · Delegate' : 'Log in · Delegate';
  }, [signup]);

  const personas = useQuery({
    queryKey: ['personas'],
    queryFn: () => api.get<{ inviteCode: string; personas: Persona[] }>('/auth/demo/personas', null),
    enabled: config?.authMode === 'demo',
    staleTime: Infinity,
  });

  if (booting && !configError) return <FullPageSpinner />;
  if (token && me) return <Navigate to={me.membership ? '/app' : '/onboarding'} replace />;

  const google = async () => {
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };

  const asPersona = async (personaId: string) => {
    setBusy(personaId);
    try {
      await signInDemo({ personaId });
      navigate('/app');
    } catch (e) {
      toast.error(e);
      setBusy(null);
    }
  };

  const fresh = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('fresh');
    try {
      await signInDemo({ email, fullName });
      navigate('/onboarding');
    } catch (err) {
      toast.error(err);
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Link to="/" aria-label="Delegate home" className="self-start">
          <Logo />
        </Link>
        <motion.div
          className="mx-auto my-auto w-full max-w-[420px] py-12"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <h1 className="text-[2.6rem] font-medium leading-[1] tracking-display">
            {signup ? (
              <>
                <span className="text-[#6d6d66]">Start handing</span> work off.
              </>
            ) : (
              <>
                <span className="text-[#6d6d66]">Welcome</span> back.
              </>
            )}
          </h1>
          <p className="mt-3 text-[15px] text-mute">
            {signup ? 'Sign up with your work Google account. Create a workspace or join your team with an invite code.' : 'Sign in with your work Google account to open your board.'}
          </p>

          {configError && (
            <p className="mt-8 rounded-2xl border border-s-open/30 bg-s-open-soft px-4 py-3 text-sm text-[#B4232A]">
              Can’t reach the Delegate API. Start it with <code className="font-mono">npm run dev</code> and refresh.
            </p>
          )}

          {config?.authMode === 'supabase' && (
            <div className="mt-8">
              <Button variant="soft" size="lg" className="w-full" onClick={google} loading={busy === 'google'}>
                <GoogleIcon /> Continue with Google
              </Button>
              <p className="mt-4 text-center text-xs text-faint">By continuing you agree to the Terms and Privacy Policy.</p>
            </div>
          )}

          {config?.authMode === 'demo' && (
            <div className="mt-8">
              <Button variant="soft" size="lg" className="w-full opacity-60" disabled title="Connect Supabase to enable Google sign-in">
                <GoogleIcon /> Continue with Google
              </Button>
              <p className="mt-3 rounded-2xl border border-line bg-paper px-4 py-3 text-[13px] leading-relaxed text-mute">
                <span className="font-medium text-ink">Demo mode.</span> Google sign-in switches on once Supabase is connected (see <code className="font-mono text-[12px]">docs/SETUP.md</code>). Meanwhile, step into the sample workspace:
              </p>

              <p className="mt-7 text-xs font-medium uppercase tracking-[0.16em] text-faint">Explore as</p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="persona-list">
                {(personas.data?.personas ?? []).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => asPersona(p.id)}
                    disabled={!!busy}
                    className={cx(
                      'group flex items-center gap-3 rounded-2xl border border-line bg-paper px-3 py-2.5 text-left transition hover:border-ink disabled:opacity-60',
                      busy === p.id && 'border-ink',
                    )}
                    data-testid={`persona-${p.id}`}
                  >
                    <Avatar name={p.fullName} size={34} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p.fullName}</span>
                      <span className="block truncate text-xs text-mute">
                        {roleLabel[p.role]} · {p.title}
                      </span>
                    </span>
                    <ArrowRight className="ml-auto size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
                  </button>
                ))}
              </div>

              <div className="my-7 flex items-center gap-3 text-xs text-faint">
                <span className="h-px flex-1 bg-line" /> or start a fresh workspace <span className="h-px flex-1 bg-line" />
              </div>
              <form onSubmit={fresh} className="space-y-3">
                <Field label="Full name">
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ada Okafor" required minLength={2} autoComplete="name" />
                </Field>
                <Field label="Work email">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" />
                </Field>
                <Button type="submit" size="lg" className="w-full" loading={busy === 'fresh'} disabled={!!busy && busy !== 'fresh'}>
                  Continue
                </Button>
              </form>
            </div>
          )}

          <p className="mt-8 text-center text-sm text-mute">
            {signup ? (
              <>
                Already have an account?{' '}
                <Link to="/login" className="font-medium text-ink underline-offset-4 hover:underline">
                  Log in
                </Link>
              </>
            ) : (
              <>
                New to Delegate?{' '}
                <Link to="/login?intent=signup" className="font-medium text-ink underline-offset-4 hover:underline">
                  Create a workspace
                </Link>
              </>
            )}
          </p>
        </motion.div>
      </div>

      <div className="relative hidden overflow-hidden border-l border-line bg-milk-2 lg:block">
        <div className="dot-grid absolute inset-0 opacity-70" />
        <motion.div
          className="absolute bottom-[-14%] left-1/2 h-[100%] -translate-x-1/2"
          initial={{ y: 120, opacity: 0, rotate: -6 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 40, damping: 14, delay: 0.1 }}
        >
          <motion.div className="h-full" animate={{ y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
            <PhotoCup
              className="h-full"
              color={KRAFT}
              print={{ status: signup ? 'Open' : 'Welcome back', meta: signup ? 'Your workspace' : 'Board ready' }}
            />
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
