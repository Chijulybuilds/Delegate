import { expect, test } from '@playwright/test';

test('a tab left open across a deploy offers to refresh', async ({ page }) => {
  const firstCheck = page.waitForResponse('**/version.json');
  await page.goto('/login');
  expect((await firstCheck).ok()).toBeTruthy(); // the build publishes its id
  await expect(page.getByTestId('update-notice')).toHaveCount(0); // same build: nothing to say

  // A new deploy goes live while the tab is in the background; coming back shows the notice.
  await page.route('**/version.json', (route) => route.fulfill({ json: { build: 'a-newer-build' } }));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByTestId('update-notice')).toContainText('Delegate has been updated');

  await page.unroute('**/version.json');
  await page.getByTestId('update-refresh').click();
  await page.waitForLoadState('load');
  await expect(page.getByTestId('update-notice')).toHaveCount(0);
});
