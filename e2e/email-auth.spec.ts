import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Email + password sign-in, against a stand-in for Supabase Auth: the app runs exactly as in
 * production (Supabase mode), and every call Supabase would answer is answered here.
 */
const SUPABASE = 'https://e2e-test.supabase.co';
// The demo server's security policy only allows its own origin (in production it also allows your
// Supabase project); let these tests reach the stand-in Supabase above.
test.use({ bypassCSP: true });

function fakeJwt(email: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-1', email, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}
const user = (email: string, identities = 1) => ({
  id: 'user-1',
  aud: 'authenticated',
  role: 'authenticated',
  email,
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Bisi Ade' },
  identities: Array.from({ length: identities }, () => ({ id: 'user-1', user_id: 'user-1', provider: 'email', identity_data: { email } })),
  created_at: new Date().toISOString(),
});

async function supabaseMode(page: Page, auth: (route: Route, path: string, body: Record<string, unknown>) => Promise<void> | void) {
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), authMode: 'supabase', supabaseUrl: SUPABASE, supabaseAnonKey: 'sb_publishable_test' } });
  });
  await page.route(`${SUPABASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const body = (route.request().postDataJSON() as Record<string, unknown> | null) ?? {};
    await auth(route, url.pathname + url.search, body);
  });
}

const fail = (route: Route, status: number, error_code: string, msg: string) => route.fulfill({ status, json: { code: status, error_code, msg } });

test.describe('Email and password', () => {
  test('sign up asks you to confirm your email, with a resend button', async ({ page }) => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    await supabaseMode(page, (route, path, body) => {
      calls.push({ path, body });
      if (path.startsWith('/auth/v1/signup')) return route.fulfill({ json: user(String(body.email)) });
      if (path.startsWith('/auth/v1/resend')) return route.fulfill({ json: {} });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto('/login?intent=signup');
    await expect(page.getByTestId('google-signin')).toContainText('Sign up with Google');
    await page.getByTestId('auth-fullname').fill('Bisi Ade');
    await page.getByTestId('auth-email').fill('bisi@lumen.example');
    await page.getByTestId('auth-password').fill('short');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText('at least 8 characters');

    await page.getByTestId('auth-password').fill('Lagos-Sunrise-42');
    await expect(page.getByText('Strong')).toBeVisible();
    await page.getByTestId('auth-submit').click();
    const sent = page.getByTestId('auth-sent');
    await expect(sent).toContainText('Check your inbox');
    await expect(sent).toContainText('bisi@lumen.example');
    const signup = calls.find((c) => c.path.startsWith('/auth/v1/signup'))!;
    expect(signup.body).toMatchObject({ email: 'bisi@lumen.example', password: 'Lagos-Sunrise-42', data: { full_name: 'Bisi Ade' } });
    await expect(page.getByTestId('auth-resend')).toBeDisabled(); // short cooldown so nobody floods their inbox
  });

  test('an address that already has an account is pointed to log in or reset', async ({ page }) => {
    await supabaseMode(page, (route, path) => (path.startsWith('/auth/v1/signup') ? route.fulfill({ json: user('ada@lumen.example', 0) }) : route.fulfill({ status: 404, json: {} })));
    await page.goto('/login?intent=signup');
    await page.getByTestId('auth-fullname').fill('Ada Okafor');
    await page.getByTestId('auth-email').fill('ada@lumen.example');
    await page.getByTestId('auth-password').fill('Lagos-Sunrise-42');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText('already exists');
    await expect(page.getByTestId('auth-error').getByRole('button', { name: 'Reset your password' })).toBeVisible();
  });

  test('log in: wrong password, unconfirmed email, then success', async ({ page }) => {
    let attempt = 0;
    await supabaseMode(page, (route, path, body) => {
      if (path.startsWith('/auth/v1/token')) {
        attempt++;
        if (attempt === 1) return fail(route, 400, 'invalid_credentials', 'Invalid login credentials');
        if (attempt === 2) return fail(route, 400, 'email_not_confirmed', 'Email not confirmed');
        return route.fulfill({ json: { access_token: fakeJwt(String(body.email)), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh', user: user(String(body.email)) } });
      }
      if (path.startsWith('/auth/v1/resend')) return route.fulfill({ json: {} });
      return route.fulfill({ status: 404, json: {} });
    });
    // The API recognises the signed-in person (no workspace yet → onboarding).
    await page.route('**/api/me', (route) =>
      route.fulfill({ json: { profile: { id: 'user-1', email: 'bisi@lumen.example', fullName: 'Bisi Ade', avatarUrl: null, status: 'active', phone: null, createdAt: new Date().toISOString() }, membership: null } }),
    );

    await page.goto('/login');
    await expect(page.getByTestId('google-signin')).toContainText('Continue with Google');
    await page.getByTestId('auth-email').fill('bisi@lumen.example');
    await page.getByTestId('auth-password').fill('not-it');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toHaveText('Wrong email or password.');

    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText('Confirm your email first');
    await page.getByRole('button', { name: 'Send the confirmation email again' }).click();
    await expect(page.getByTestId('auth-sent')).toContainText('confirmation link');
    await page.getByRole('button', { name: 'Use a different email' }).click();

    await page.getByTestId('auth-email').fill('bisi@lumen.example');
    await page.getByTestId('auth-password').fill('Lagos-Sunrise-42');
    await page.getByTestId('auth-submit').click();
    await page.waitForURL('**/onboarding');
  });

  test('forgot password sends a reset link', async ({ page }) => {
    let recovered: Record<string, unknown> | null = null;
    await supabaseMode(page, (route, path, body) => {
      if (path.startsWith('/auth/v1/recover')) {
        recovered = body;
        return route.fulfill({ json: {} });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto('/login');
    await page.getByTestId('auth-forgot').click();
    await page.getByTestId('forgot-email').fill('bisi@lumen.example');
    await page.getByTestId('forgot-submit').click();
    await expect(page.getByTestId('auth-sent')).toContainText('password reset link');
    expect(recovered).toMatchObject({ email: 'bisi@lumen.example' });
  });

  test('a stale reset link explains itself and offers a new one', async ({ page }) => {
    await supabaseMode(page, (route, path) =>
      path.startsWith('/auth/v1/verify') ? fail(route, 403, 'otp_expired', 'Email link is invalid or has expired') : route.fulfill({ status: 404, json: {} }),
    );
    await page.goto('/auth/reset?token_hash=old&type=recovery');
    await expect(page.getByTestId('reset-problem')).toContainText('expired');
    await page.getByRole('link', { name: 'Send me a new link' }).click();
    await expect(page.getByTestId('forgot-form')).toBeVisible();
  });
});
