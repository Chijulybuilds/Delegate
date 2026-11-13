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
      signInDemo,
      signOut,
      refreshMe: () => meQuery.refetch(),
    }),
    [config, configQuery.isError, configQuery.error, meErrorMessage, sessionChecked, token, meQuery, signInWithGoogle, signInDemo, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
