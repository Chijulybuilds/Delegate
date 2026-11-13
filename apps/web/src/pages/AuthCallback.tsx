import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { Button, FullPageSpinner } from '../components/ui';
import { useAuth } from '../lib/auth';

/** Google → Supabase redirects here. supabase-js exchanges the code, then we route onwards. */
export default function AuthCallback() {
  const { token, me, booting, meError, configErrorMessage } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const error = new URLSearchParams(window.location.search).get('error_description') ?? new URLSearchParams(window.location.hash.slice(1)).get('error_description');

  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 12_000);
    return () => clearTimeout(id);
  }, []);

  // Signed in with Google, but the API couldn't load the account: say why instead of spinning.
  const problem = error ?? meError ?? configErrorMessage;
  if (problem || (timedOut && !token)) {
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-medium tracking-[-0.03em]">Sign-in didn’t complete</h1>
          <p className="mt-2 max-w-md text-sm text-mute" data-testid="callback-problem">
            {problem ?? 'The sign-in link may have expired. Please try again.'}
          </p>
          <Link to="/login" className="mt-6 inline-block">
            <Button>Back to sign in</Button>
          </Link>
        </div>
      </div>
    );
  }
  if (token && me && !booting) return <Navigate to={me.membership ? '/app' : '/onboarding'} replace />;
  return <FullPageSpinner />;
}
