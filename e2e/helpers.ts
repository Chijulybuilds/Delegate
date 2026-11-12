import { expect, type APIRequestContext, type Page } from '@playwright/test';

export async function resetDemo(request: APIRequestContext) {
  const res = await request.post('/api/demo/reset');
  expect(res.ok()).toBeTruthy();
}

/** Signs in through the real login page as one of the seeded demo personas. */
export async function loginAs(page: Page, personaId: string) {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByTestId(`persona-${personaId}`).click();
  await page.waitForURL('**/app');
  await expect(page.getByRole('heading', { name: 'Today’s board' })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.evaluate(() => localStorage.clear());
}

export const lane = (page: Page, id: 'open' | 'active' | 'done' | 'approved') => page.getByTestId(`lane-${id}`);
export const card = (page: Page, title: string) => page.locator(`[data-testid="task-card"][data-task-title="${title}"]`);
