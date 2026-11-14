import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { Button, FullPageSpinner } from '../components/ui';
import { useAuth } from '../lib/auth';

/**
 * Where sign-in links land: Google (via Supabase) and the "confirm your email" link.
 *   ?code=…                    supabase-js exchanges it by itself (same browser as sign-up)
 *   ?token_hash=…&type=email   we verify it here (works on any device — see docs/SETUP.md templates)
 */
export default function AuthCallback() {
  const { config, token, me, booting, meError, configErrorMessage, verifyEmailLink } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const verifying = useRef(false);
  // Read the link once: supabase-js tidies the address bar after using it.
  const [search] = useState(() => new URLSearchParams(window.location.search));
  const [error] = useState(() => search.get('error_description') ?? new URLSearchParams(window.location.hash.slice(1)).get('error_description'));
  const hadCode = search.has('code');

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 12_000);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const tokenHash = search.get('token_hash');
    const type = search.get('type');
    if (!tokenHash || !type || !config || verifying.current) return;
    verifying.current = true;
    verifyEmailLink(tokenHash, type).catch((e: Error) => setLinkError(e.message));
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  // Signed in, but the API couldn't load the account: say why instead of spinning.
  const problem = error ?? linkError ?? meError ?? configErrorMessage;
  if (problem || (timedOut && !token)) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-medium tracking-[-0.03em]">Sign-in didn’t complete</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-mute" data-testid="callback-problem">
            {problem ??
              (hadCode
                ? 'This link was opened in a different browser from the one you signed up in, or it has expired. If you were confirming your email, it’s confirmed — just log in with your password.'
                : 'The sign-in link may have expired. Please try again.')}
          </p>
          <Link to="/login" className="mt-6 inline-block">
            <Button>Go to log in</Button>
          </Link>
        </div>
      </div>
    );
  }
  if (token && me && !booting) return <Navigate to={me.membership ? '/app' : '/onboarding'} replace />;
  return <FullPageSpinner />;
}
