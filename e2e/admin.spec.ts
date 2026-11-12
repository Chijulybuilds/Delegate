import { expect, test, type Page } from '@playwright/test';
import { loginAs, resetDemo } from './helpers';

async function adminLogin(page: Page, password = 'delegate-admin') {
  await page.goto('/admin');
  await page.getByTestId('admin-email').fill('admin@delegate.local');
  await page.getByTestId('admin-password').fill(password);
  await page.getByTestId('admin-submit').click();
}

test.describe.serial('Platform admin console (/admin)', () => {
  test.beforeAll(async ({ request }) => {
    await resetDemo(request);
  });

  test('is reachable only by URL and asks for console credentials', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText('Delegate Console')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await adminLogin(page, 'wrong-password');
    await expect(page.getByTestId('admin-error')).toContainText('Invalid admin credentials');
  });

  test('an operator sees platform metrics, workspaces, users and the ledger', async ({ page }) => {
    await adminLogin(page);
    await expect(page.getByTestId('admin-overview')).toBeVisible();
    await expect(page.getByTestId('admin-kpi-orgs')).toContainText('1');
    await expect(page.getByTestId('admin-kpi-users')).toContainText('6');

    await page.getByRole('tab', { name: 'Workspaces' }).click();
    await expect(page.getByTestId('admin-orgs')).toContainText('Lumen & Co.');
    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page.getByTestId('admin-users')).toContainText('ada@lumen.example');
    await page.getByRole('tab', { name: 'Ledger' }).click();
    await expect(page.getByTestId('admin-ledger')).toContainText('task.approved');
  });

  test('suspending a workspace locks its members out; reactivating restores access', async ({ page, context }) => {
    await adminLogin(page);
    await page.getByRole('tab', { name: 'Workspaces' }).click();
    await page.getByTestId('org-toggle-lumen').click();
    await expect(page.getByTestId('admin-orgs')).toContainText('suspended');

    const member = await context.newPage();
    await member.goto('/login');
    await member.getByTestId('persona-demo-tunde').click();
    await expect(member.getByTestId('workspace-unavailable')).toContainText('suspended');

    await page.getByTestId('org-toggle-lumen').click();
    await expect(page.getByTestId('org-toggle-lumen')).toHaveText('Suspend');
    await member.reload();
    await expect(member.getByRole('heading', { name: 'Today’s board' })).toBeVisible();
  });

  test('a customer session is not an admin session', async ({ page, request }) => {
    await loginAs(page, 'demo-ada');
    const token = await page.evaluate(() => localStorage.getItem('delegate.demoToken'));
    const res = await request.get('/api/admin/overview', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(401);
    await page.goto('/admin');
    await expect(page.getByTestId('admin-login')).toBeVisible();
  });

  test('signing out of the console returns to its login', async ({ page }) => {
    await adminLogin(page);
    await expect(page.getByTestId('admin-email-display')).toHaveText('admin@delegate.local');
    await page.getByTestId('admin-signout').click();
    await expect(page.getByTestId('admin-login')).toBeVisible();
  });
});
