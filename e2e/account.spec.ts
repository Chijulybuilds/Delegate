import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { choose, loginAs, resetDemo } from './helpers';

/** Leave workspace, delete account, and a manager removing someone who left the company. */

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login?intent=signup');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL('**/onboarding');
}

/** Someone joins a workspace through the API (no browser needed). Returns their user id. */
async function joinViaApi(request: APIRequestContext, name: string, email: string, code = 'LUMEN-2026') {
  const token = (await (await request.post('/api/auth/demo', { data: { email, fullName: name } })).json()).token as string;
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.post('/api/onboarding/join', { headers, data: { code } })).ok()).toBeTruthy();
  return (await (await request.get('/api/me', { headers })).json()).profile.id as string;
}

test.describe('leave workspace & delete account', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('a teammate leaves from the avatar menu, then deletes their account', async ({ page }) => {
    const email = `femi.${Date.now()}@lumen.example`;
    await signUp(page, 'Femi Lawal', email);
    await page.getByLabel('Invite code').fill('LUMEN-2026');
    await page.getByRole('button', { name: 'Join workspace' }).click();
    await page.waitForURL('**/app');

    await page.getByTestId('user-menu').click();
    await page.getByTestId('user-menu-leave').click();
    await expect(page).toHaveURL(/tab=account/);
    await expect(page.getByTestId('danger-zone')).toBeInViewport();

    await page.getByTestId('leave-workspace').click();
    const dialog = page.getByRole('dialog', { name: 'Leave Lumen & Co.?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('You have no unfinished tasks to hand over.');
    await dialog.getByTestId('confirm-leave-delete').click();
    await page.waitForURL('**/onboarding');
    await expect(page.getByText('You left Lumen & Co.')).toBeVisible();

    // From the onboarding screen (no workspace any more) they delete the account.
    await page.getByTestId('onboarding-delete-account').click();
    const del = page.getByRole('dialog', { name: 'Delete your account?' });
    await expect(del.getByTestId('confirm-leave-delete')).toBeDisabled();
    await del.getByTestId('confirm-delete').fill('delete');
    await del.getByTestId('confirm-leave-delete').click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.getByText('Your account has been deleted')).toBeVisible();

    // The same email starts over as a brand-new person.
    await signUp(page, 'Femi Lawal', email);
    await expect(page.getByLabel('Invite code')).toBeVisible();
  });

  test('an owner hands the workspace over before leaving', async ({ page, request }) => {
    const stamp = Date.now();
    await signUp(page, 'Ngozi Eze', `ngozi.${stamp}@kite.example`);
    await page.getByLabel('Company or team name').fill('Kite Studio');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.waitForURL('**/app');
    await page.getByRole('link', { name: 'Team', exact: true }).click();
    const code = (await page.getByTestId('invite-code').textContent())!.trim();
    const heirId = await joinViaApi(request, 'Obi Kalu', `obi.${stamp}@kite.example`, code);

    await page.goto('/app/settings?tab=account');
    await page.getByTestId('leave-workspace').click();
    const dialog = page.getByRole('dialog', { name: 'Leave Kite Studio?' });
    await expect(dialog.getByTestId('confirm-leave-delete')).toBeDisabled();
    await choose(page, 'new-owner', heirId);
    await expect(dialog).toContainText('They get full control');
    await dialog.getByTestId('confirm-leave-delete').click();
    await page.waitForURL('**/onboarding');
  });

  test('the last person deleting their account also deletes the workspace', async ({ page }) => {
    await signUp(page, 'Solo Founder', `solo.${Date.now()}@one.example`);
    await page.getByLabel('Company or team name').fill('One Person Co');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.waitForURL('**/app');

    await page.goto('/app/settings?tab=account');
    await expect(page.getByTestId('leave-workspace')).toBeDisabled(); // nobody to hand over to
    await page.getByTestId('delete-account').click();
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' });
    await expect(dialog).toContainText('so the workspace is deleted too');
    await dialog.getByTestId('confirm-delete').fill('DELETE');
    await expect(dialog.getByTestId('confirm-leave-delete')).toHaveText('Delete account and workspace');
    await dialog.getByTestId('confirm-leave-delete').click();
    await page.waitForURL((u) => u.pathname === '/');
  });

  test('a manager removes someone who left the company and gets their tasks', async ({ page, request }) => {
    const id = await joinViaApi(request, 'Gone Person', `gone.${Date.now()}@lumen.example`);
    await loginAs(page, 'demo-ada');
    await page.getByRole('link', { name: 'Team', exact: true }).click();
    await expect(page.getByTestId('member-list')).toContainText('Gone Person');
    await expect(page.getByTestId('remove-member-demo-ada')).toHaveCount(0); // can't remove yourself

    await page.getByTestId(`remove-member-${id}`).click();
    await page.getByTestId('confirm-remove-member').click();
    await expect(page.getByText('Gone Person removed from the workspace')).toBeVisible();
    await expect(page.getByTestId('member-list')).not.toContainText('Gone Person');

    await page.getByRole('link', { name: 'Activity' }).click();
    await expect(page.getByText('Ada Okafor removed Gone Person from the workspace')).toBeVisible();
  });
});
