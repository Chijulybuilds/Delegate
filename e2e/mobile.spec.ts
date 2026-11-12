import { expect, test } from '@playwright/test';

test('mobile: menu opens and the hero fits the screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('link', { name: 'Log in' }).last()).toBeVisible();
  await page.getByRole('link', { name: 'Pricing' }).last().click();
  await expect(page.locator('#pricing')).toBeInViewport({ ratio: 0.1 });
});

test('mobile: a staff member can open their board', async ({ page, request }) => {
  await request.post('/api/demo/reset');
  await page.goto('/login');
  await page.getByTestId('persona-demo-tunde').click();
  await page.waitForURL('**/app');
  await expect(page.getByRole('heading', { name: 'Today’s board' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' }).last()).toBeVisible();
});
