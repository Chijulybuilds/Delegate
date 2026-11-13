import { expect, test } from '@playwright/test';
import { card, loginAs, resetDemo } from './helpers';

const theme = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

test.describe('Dashboard appearance', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('the avatar menu switches the dashboard to dark; the landing page stays light', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    expect(await theme(page)).toBeNull();

    await page.getByTestId('user-menu').click();
    const menu = page.getByTestId('user-menu-panel');
    await expect(menu).toContainText('Appearance');
    await menu.getByTestId('theme-dark').click();
    await expect.poll(() => theme(page)).toBe('dark');
    await expect(menu.getByTestId('theme-dark')).toHaveAttribute('aria-checked', 'true');

    // Remembered across reloads, applied before the first paint.
    await page.reload();
    expect(await theme(page)).toBe('dark');
    await expect(page.getByRole('heading', { name: 'Today’s board' })).toBeVisible();

    // The public site is always light…
    await page.goto('/');
    expect(await theme(page)).toBeNull();
    // …and the dashboard comes back dark.
    await page.goto('/app');
    expect(await theme(page)).toBe('dark');

    await page.getByTestId('user-menu').click();
    await page.getByTestId('theme-light').click();
    await expect.poll(() => theme(page)).toBeNull();
  });

  test('the menu links to account settings and signs out', async ({ page }) => {
    await loginAs(page, 'demo-tunde');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('user-menu-account').click();
    await expect(page).toHaveURL(/\/app\/settings\?tab=account/);
    await page.getByTestId('user-menu').click();
    await page.getByTestId('user-menu-signout').click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Dropdowns', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('open, glide and choose with the keyboard; Esc closes', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    const person = page.getByTestId('filter-person');
    await person.focus();
    await page.keyboard.press('Enter');
    const list = page.getByRole('listbox', { name: 'Filter by person' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('option')).toHaveCount(7); // "Every person" + 6 teammates
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
    await expect(person).toBeFocused();

    // Short lists jump as you type (long ones get a search box); Enter picks: the board narrows.
    await page.keyboard.press('ArrowDown');
    await expect(list).toBeVisible();
    await page.keyboard.type('tun');
    await page.keyboard.press('Enter');
    await expect(person).toHaveAttribute('data-value', 'demo-tunde');
    await expect(person).toContainText('Tunde Bakare');
    await expect(page.getByTestId('task-card').filter({ hasNotText: 'Tunde' })).toHaveCount(0);
  });

  test('Esc inside a modal closes only the dropdown; a click outside closes it too', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-assignee').click();
    await expect(page.getByRole('listbox', { name: 'Assignee' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Assign a task' })).toBeVisible();

    await page.getByTestId('task-assignee').click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.getByTestId('task-title').click();
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });

  test('long lists are searchable (time zones)', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.goto('/app/settings?tab=workspace');
    await page.getByRole('combobox', { name: 'Time zone' }).click();
    await page.keyboard.type('lagos');
    const list = page.getByRole('listbox', { name: 'Time zone' });
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(list.getByRole('option').first()).toContainText('Africa/Lagos');
  });

  test('inline dropdowns in the task drawer edit the task', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await card(page, 'Write job post for ops associate').click();
    await page.getByRole('combobox', { name: 'Priority' }).click();
    await page.locator('[role="listbox"] [role="option"][data-value="urgent"]').click();
    await expect(page.getByRole('combobox', { name: 'Priority' })).toContainText('Urgent');
  });
});
