import { expect, test } from '@playwright/test';
import { resetDemo } from './helpers';

/**
 * A Google sign-up adds a password in Settings → Account. Supabase is a stand-in (the app runs in
 * Supabase mode); the API calls go to the demo server as Ada.
 */
const SUPABASE = 'https://e2e-test.supabase.co';
test.use({ bypassCSP: true });

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeJwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'demo-ada', email: 'ada@lumen.example', aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

function googleUser(hasPassword: boolean) {
  return {
    id: 'demo-ada',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'ada@lumen.example',
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Ada Okafor', ...(hasPassword ? { has_password: true } : {}) },
    identities: [{ id: 'g-1', user_id: 'demo-ada', provider: 'google', identity_data: { email: 'ada@lumen.example' } }],
    created_at: new Date().toISOString(),
  };
}

test('someone who signed up with Google can add a password later', async ({ page, request }) => {
  await resetDemo(request);
  const demoToken = (await (await request.post('/api/auth/demo', { data: { personaId: 'demo-ada' } })).json()).token as string;
  let hasPassword = false;
  const updates: Array<Record<string, unknown>> = [];
  let reauths = 0;

  // The app thinks it's on Supabase…
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), authMode: 'supabase', supabaseUrl: SUPABASE, supabaseAnonKey: 'sb_publishable_test' } });
  });
  // …its API calls reach the demo server as Ada…
  await page.route('**/api/**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/config') return route.fallback();
    return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${demoToken}` } });
  });
  // …and Supabase Auth answers like a Google-only account with "Secure password change" on.
  await page.route(`${SUPABASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/auth/v1/user' && method === 'GET') return route.fulfill({ json: googleUser(hasPassword) });
    if (url.pathname === '/auth/v1/user' && method === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      updates.push(body);
      if (!body.nonce) return route.fulfill({ status: 400, json: { code: 400, error_code: 'reauthentication_needed', msg: 'Password update requires reauthentication' } });
      if (body.nonce !== '482913') return route.fulfill({ status: 400, json: { code: 400, error_code: 'reauthentication_not_valid', msg: 'Requested nonce is invalid' } });
      hasPassword = true;
      return route.fulfill({ json: googleUser(true) });
    }
    if (url.pathname === '/auth/v1/reauthenticate') {
      reauths++;
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ status: 404, json: {} });
  });

  // Already signed in with Google (the session supabase-js keeps in localStorage).
  await page.goto('/');
  await page.evaluate(
    ({ session }) => localStorage.setItem('sb-e2e-test-auth-token', JSON.stringify(session)),
    { session: { access_token: fakeJwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: googleUser(false) } },
  );
  await page.goto('/app/settings?tab=account');

  const card = page.getByTestId('password-card');
  await expect(card.getByTestId('method-google')).toHaveAttribute('data-on', 'true');
  await expect(card.getByTestId('method-email-password')).toHaveAttribute('data-on', 'false');
  await expect(card).toContainText('You sign in with Google. Add a password');

  await card.getByTestId('password-start').click();
  await card.getByTestId('password-new').fill('Lagos-Sunrise-42');
  await card.getByTestId('password-confirm').fill('Lagos-Sunrise-41');
  await card.getByTestId('password-save').click();
  await expect(card.getByTestId('password-error')).toContainText('don’t match');
  expect(updates).toHaveLength(0); // checked before anything is sent

  await card.getByTestId('password-confirm').fill('Lagos-Sunrise-42');
  await card.getByTestId('password-save').click();
  // Supabase wants proof: a code is emailed and the boxes appear.
  await expect(card.getByTestId('password-code')).toContainText('ada@lumen.example');
  expect(reauths).toBe(1);

  await page.keyboard.type('111111');
  await expect(card.getByTestId('password-error')).toContainText('wrong or has expired');
  await card.getByTestId('password-code-input').fill('482913');
  await expect(page.getByText('Password set — you can now also log in with your email and password')).toBeVisible();
  expect(updates.at(-1)).toMatchObject({ password: 'Lagos-Sunrise-42', nonce: '482913', data: { has_password: true } });
  await expect(card.getByTestId('method-email-password')).toHaveAttribute('data-on', 'true');
  await expect(card.getByTestId('password-start')).toHaveText(/Change password/);
});
