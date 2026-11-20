import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import type { AppConfig, MeResponse } from '@delegate/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, configureApi } from './api';
import { getSupabase } from './supabase';

const DEMO_TOKEN_KEY = 'delegate.demoToken';

function readDemoToken(): string | null {
  try {
    return localStorage.getItem(DEMO_TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeDemoToken(token: string | null) {
  try {
    if (token) localStorage.setItem(DEMO_TOKEN_KEY, token);
    else localStorage.removeItem(DEMO_TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — session lives in memory only */
  }
}

interface AuthState {
  config: AppConfig | null;
  configError: boolean;
  /** Why the API couldn't be reached or started, in words a person can act on. */
  configErrorMessage: string | null;
  /** Signed in (token present) but the account couldn't be loaded. */
  meError: string | null;
  /** True until we know whether a session exists. */
  booting: boolean;
  token: string | null;
  me: MeResponse | null;
  meLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  /** Email + password (Supabase). `needsConfirmation` = we emailed a link to confirm the address first. */
  signUpWithPassword: (input: { fullName: string; email: string; password: string }) => Promise<{ needsConfirmation: boolean }>;
  signInWithPassword: (input: { email: string; password: string }) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  /** Sends the sign-up code (or link, with Supabase's default template) again. */
  resendConfirmation: (email: string) => Promise<void>;
  /** Checks the code from the sign-up email; on success the person is signed in. */
  verifyEmailCode: (email: string, code: string) => Promise<void>;
  /** Sets or changes the password of the signed-in person. `nonce` = the code from a re-authentication email. */
  updatePassword: (password: string, nonce?: string) => Promise<void>;
  /** How the signed-in person can log in (a Google sign-up can add a password later). */
  signInMethods: () => Promise<{ email: string; google: boolean; password: boolean }>;
  /** Emails a code to confirm it's really them (Supabase asks for it before some password changes). */
  sendReauthCode: () => Promise<void>;
  /** Email links that carry ?token_hash=…&type=… (confirm sign-up, reset password). */
  verifyEmailLink: (tokenHash: string, type: string) => Promise<void>;
  signInDemo: (input: { personaId: string } | { email: string; fullName: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<unknown>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get<AppConfig>('/config', null),
    staleTime: Infinity,
    retry: 1,
  });
  const config = configQuery.data ?? null;

  const clearSession = useCallback(() => {
    writeDemoToken(null);
    setToken(null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'config' });
  }, [qc]);

  // A Google session the API refuses would otherwise just bounce back to sign-in with no reason.
  const [rejected, setRejected] = useState<string | null>(null);
  useEffect(() => {
    configureApi({
      getToken: () => tokenRef.current,
      onUnauthorized: (error) => {
        if (config?.authMode === 'supabase') {
          setRejected(`The server didn’t accept your Google session (${error.message}). Check that the API’s SUPABASE_URL is the same project you signed in to, then try again.`);
        }
        clearSession();
      },
    });
  }, [clearSession, config?.authMode]);
  useEffect(() => {
    if (token && rejected) setRejected(null);
  }, [token, rejected]);

  // Resolve the session once we know which auth mode the API runs in.
  useEffect(() => {
    if (!config) return;
    if (config.authMode === 'demo') {
      setToken(readDemoToken());
      setSessionChecked(true);
      return;
    }
    let mounted = true;
    let unsubscribe: (() => void) | null = null;
    getSupabase(config.supabaseUrl!, config.supabaseAnonKey!).then(async (sb) => {
      const { data } = await sb.auth.getSession();
      if (!mounted) return;
      setToken(data.session?.access_token ?? null);
      setSessionChecked(true);
      const { data: sub } = sb.auth.onAuthStateChange((_event, session: Session | null) => {
        setToken(session?.access_token ?? null);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [config]);

  useEffect(() => {
    if (configQuery.isError) setSessionChecked(true);
  }, [configQuery.isError]);

  const meQuery = useQuery({
    queryKey: ['me', token],
    queryFn: () => api.get<MeResponse>('/me'),
    enabled: !!token,
    staleTime: 30_000,
    retry: false,
  });

  const signInWithGoogle = useCallback(async () => {
    if (!config?.supabaseUrl || !config.supabaseAnonKey) throw new Error('Google sign-in is not configured');
    const sb = await getSupabase(config.supabaseUrl, config.supabaseAnonKey);
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: 'select_account' } },
    });
    if (error) throw error;
  }, [config]);

  const supabase = useCallback(async () => {
    if (!config?.supabaseUrl || !config.supabaseAnonKey) throw new Error('Email sign-in needs Supabase to be connected.');
    return getSupabase(config.supabaseUrl, config.supabaseAnonKey);
  }, [config]);

  const signUpWithPassword = useCallback(
    async ({ fullName, email, password }: { fullName: string; email: string; password: string }) => {
      const sb = await supabase();
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw friendlyAuthError(error);
      // Supabase doesn't reveal existing accounts: a confirmed address comes back with no identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new AuthUiError('An account with this email already exists. Log in instead, or reset your password.', 'user_already_exists');
      }
      return { needsConfirmation: !data.session };
    },
    [supabase],
  );

  const signInWithPassword = useCallback(
    async ({ email, password }: { email: string; password: string }) => {
      const { error } = await (await supabase()).auth.signInWithPassword({ email, password });
      if (error) throw friendlyAuthError(error);
    },
    [supabase],
  );

  const sendPasswordReset = useCallback(
    async (email: string) => {
      const { error } = await (await supabase()).auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/reset` });
      if (error) throw friendlyAuthError(error);
    },
    [supabase],
  );

  const resendConfirmation = useCallback(
    async (email: string) => {
      const { error } = await (await supabase()).auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (error) throw friendlyAuthError(error);
    },
    [supabase],
  );

  const verifyEmailCode = useCallback(
    async (email: string, code: string) => {
      const sb = await supabase();
      let { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
      // Older Supabase Auth versions only accept sign-up codes as type "signup".
      if (error && (error.code === 'otp_expired' || /expired|invalid/i.test(error.message))) ({ error } = await sb.auth.verifyOtp({ email, token: code, type: 'signup' }));
      if (error) throw friendlyAuthError(error, 'code');
    },
    [supabase],
  );

  const updatePassword = useCallback(
    async (password: string, nonce?: string) => {
      // has_password lets Settings show "Email & password" for Google sign-ups that added one.
      const { error } = await (await supabase()).auth.updateUser({ password, ...(nonce ? { nonce } : {}), data: { has_password: true } });
      if (error) throw friendlyAuthError(error, nonce ? 'code' : 'link');
    },
    [supabase],
  );

  const signInMethods = useCallback(async () => {
    const { data, error } = await (await supabase()).auth.getUser();
    if (error || !data.user) throw friendlyAuthError(error ?? { message: 'Not signed in' });
    const u = data.user;
    const providers = new Set([...(u.identities ?? []).map((i) => i.provider), ...((u.app_metadata?.providers as string[] | undefined) ?? [])]);
    return { email: u.email ?? '', google: providers.has('google'), password: providers.has('email') || u.user_metadata?.has_password === true };
  }, [supabase]);

  const sendReauthCode = useCallback(async () => {
    const { error } = await (await supabase()).auth.reauthenticate();
    if (error) throw friendlyAuthError(error);
  }, [supabase]);

  const verifyEmailLink = useCallback(
    async (tokenHash: string, type: string) => {
      const { error } = await (await supabase()).auth.verifyOtp({ token_hash: tokenHash, type: type as 'email' });
      if (error) throw friendlyAuthError(error);
    },
    [supabase],
  );

  const signInDemo = useCallback(
    async (input: { personaId: string } | { email: string; fullName: string }) => {
      const { token: t } = await api.post<{ token: string }>('/auth/demo', input, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'config' });
      writeDemoToken(t);
      setToken(t);
      await qc.fetchQuery({ queryKey: ['me', t], queryFn: () => api.get<MeResponse>('/me', t) });
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    if (config?.authMode === 'supabase' && config.supabaseUrl && config.supabaseAnonKey) {
      await (await getSupabase(config.supabaseUrl, config.supabaseAnonKey)).auth.signOut();
    }
    clearSession();
  }, [config, clearSession]);

  const meErrorMessage = token && meQuery.isError ? describeError(meQuery.error) : rejected;
  const value = useMemo<AuthState>(
    () => ({
      config,
      configError: configQuery.isError,
      configErrorMessage: configQuery.isError ? describeError(configQuery.error) : null,
      meError: meErrorMessage,
      booting: !sessionChecked || (!!token && meQuery.isLoading),
      token,
      me: meQuery.data ?? null,
      meLoading: meQuery.isLoading,
      signInWithGoogle,
      signUpWithPassword,
      signInWithPassword,
      sendPasswordReset,
      resendConfirmation,
      verifyEmailCode,
      updatePassword,
      signInMethods,
      sendReauthCode,
      verifyEmailLink,
      signInDemo,
      signOut,
      refreshMe: () => meQuery.refetch(),
    }),
    [config, configQuery.isError, configQuery.error, meErrorMessage, sessionChecked, token, meQuery, signInWithGoogle, signUpWithPassword, signInWithPassword, sendPasswordReset, resendConfirmation, verifyEmailCode, updatePassword, signInMethods, sendReauthCode, verifyEmailLink, signInDemo, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** A sign-in error with a stable code the UI can react to (e.g. offer "resend email"). */
export class AuthUiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    /** Seconds to wait before asking for another email, when Supabase says so. */
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Supabase Auth errors, in plain words. */
function friendlyAuthError(error: { message: string; code?: string; status?: number }, context: 'code' | 'link' = 'link'): AuthUiError {
  const code = error.code ?? '';
  const msg = error.message ?? '';
  // "For security purposes, you can only request this after 42 seconds."
  const wait = /after (\d+) seconds?/i.exec(msg);
  if (wait) return new AuthUiError(`Please wait ${wait[1]} seconds before asking for another email.`, 'wait', Number(wait[1]));
  if (code === 'reauthentication_needed' || /requires reauthentication/i.test(msg)) {
    return new AuthUiError('To keep your account safe, confirm it’s you with the code we email you.', 'reauthentication_needed');
  }
  if (code === 'reauthentication_not_valid' || /nonce/i.test(msg)) {
    return new AuthUiError('That code is wrong or has expired. Check the newest email, or send a new code.', 'code_invalid');
  }
  if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(msg)) {
    return new AuthUiError('Too many emails have gone out in the last hour. Try again a little later, or use Google.', 'email_rate_limited', 60);
  }
  if (context === 'code' && (code === 'otp_expired' || /expired|invalid/i.test(msg))) {
    return new AuthUiError('That code is wrong or has expired. Check the newest email, or send a new code.', 'code_invalid');
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return new AuthUiError('Wrong email or password.', 'invalid_credentials');
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
    return new AuthUiError('Confirm your email first: we’ll email you a code to type in here.', 'email_not_confirmed');
  }
  if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(msg)) {
    return new AuthUiError('An account with this email already exists. Log in instead, or reset your password.', 'user_already_exists');
  }
  if (code === 'weak_password') return new AuthUiError(`Choose a stronger password. ${msg}`.trim(), code);
  if (code === 'same_password') return new AuthUiError('That’s your current password. Choose a new one.', code);
  if (code.startsWith('over_') || /rate limit/i.test(msg)) {
    return new AuthUiError('Too many attempts just now. Wait a minute and try again.', 'rate_limited');
  }
  if (code === 'email_provider_disabled' || code === 'signup_disabled' || /signups not allowed|email logins are disabled/i.test(msg)) {
    return new AuthUiError('Email sign-up is switched off for Delegate right now. Use Continue with Google.', code || 'email_disabled');
  }
  if (code === 'otp_expired' || /expired|invalid.*(token|link)/i.test(msg)) {
    return new AuthUiError('This link has expired or was already used. Request a new one.', 'link_expired');
  }
  // Supabase couldn't hand the email to the mail server (custom SMTP settings wrong, or the sender refused it).
  if (/error sending .*email|sending (confirmation|recovery|magic link)/i.test(msg)) {
    return new AuthUiError('We couldn’t send the email just now, so your account wasn’t created yet. Please try again in a few minutes, or use Google.', 'email_send_failed');
  }
  if (code === 'email_address_not_authorized' || /not authorized/i.test(msg)) {
    return new AuthUiError('Emails to this address aren’t allowed yet. Please use Google, or try again later.', 'email_not_authorized');
  }
  if (code === 'email_address_invalid' || /invalid.*email|unable to validate email/i.test(msg)) return new AuthUiError('That email address doesn’t look right.', 'email_invalid');
  return new AuthUiError(msg || 'Something went wrong. Please try again.', code || 'auth_error');
}

/** Turns a failed API call into something a person can act on. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    // The API explained itself (missing package, missing env var, missing migration…).
    if (error.code !== 'error' || error.status < 500) return error.message;
    // A bare 5xx from the dev proxy or the host: the API process isn't answering.
    return 'The Delegate API isn’t responding. If you run it on your computer, look at the terminal running “npm run dev” for a red [api] error. After pulling new code, run “npm install” first, then “npm run dev” again.';
  }
  if (error instanceof TypeError) return 'Can’t reach the Delegate API. Check your internet connection, or that “npm run dev” is running.';
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
