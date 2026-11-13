import { expect, test } from '@playwright/test';

/**
 * "Login doesn't work" must never be a mystery: every way sign-in can fail shows the reason and
 * the fix on the sign-in page itself.
 */
test.describe('Sign-in problems explain themselves', () => {
  test('the API could not start (e.g. a package was not installed)', async ({ page }) => {
    const message = 'The Delegate API can\'t start because the package "stripe" isn\'t installed. New packages were added in the latest update: run "npm install" in the project folder, then start "npm run dev" again.';
    await page.route('**/api/config', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'api_not_started', message } }) }));
    await page.goto('/login');
    await expect(page.getByTestId('login-problem')).toHaveText(message);
  });

  test('the API process is not answering at all', async ({ page }) => {
    await page.route('**/api/config', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' }));
    await page.goto('/login');
    await expect(page.getByTestId('login-problem')).toContainText('isn’t responding');
    await expect(page.getByTestId('login-problem')).toContainText('npm install');
  });

  test('the database is missing a migration', async ({ page }) => {
    const issue = 'The Supabase database is missing the latest migration: open Supabase → SQL Editor and run supabase/migrations/20261113000000_saas.sql.';
    await page.route('**/api/config', async (r) => {
      const res = await r.fetch();
      r.fulfill({ response: res, json: { ...(await res.json()), setupIssue: issue } });
    });
    await page.goto('/login');
    await expect(page.getByTestId('login-problem')).toHaveText(issue);
  });

  test('signed in, but the account fails to load: say why, offer to retry', async ({ page }) => {
    await page.route('**/api/me', (r) =>
      r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'setup_incomplete', message: 'Run the latest Supabase migration.' } }) }),
    );
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('delegate.demoToken', 'stale-or-valid-token'));
    await page.goto('/login');
    const problem = page.getByTestId('login-problem');
    await expect(problem).toContainText('You’re signed in, but Delegate couldn’t load your account.');
    await expect(problem).toContainText('Run the latest Supabase migration.');
    await expect(problem.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('Google sign-in that lands on the home page is finished, not dropped', async ({ page }) => {
    await page.goto('/?code=abc123');
    await expect(page).toHaveURL(/\/auth\/callback\?code=abc123/);
  });
});
