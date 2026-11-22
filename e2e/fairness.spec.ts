import { expect, test } from '@playwright/test';
import { card, choose, loginAs, resetDemo } from './helpers';

test.describe('Fair Insights', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('a task gets a size, and the size suggests a fair deadline', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByTestId('new-task').click();
    const due = page.getByTestId('task-due');
    await choose(page, 'task-size', 'l');
    await expect(page.getByText('A fair deadline for a large task.')).toBeVisible();
    await expect(due).toContainText('18:00'); // tomorrow evening
    await page.getByTestId('task-title').fill('Edit the 1-hour conference video');
    await page.getByTestId('task-submit').click();
    await card(page, 'Edit the 1-hour conference video').click();
    await expect(page.getByTestId('drawer-size')).toHaveAttribute('data-value', 'l');
    await choose(page, 'drawer-size', 'xl');
    await expect(page.getByText('Task updated')).toBeVisible();
  });

  test('the leaderboard ranks by a fair score and explains it', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.goto('/app/insights?tab=velocity');
    await expect(page.getByTestId('kpi-work')).toContainText('h');
    const rows = page.getByTestId('leaderboard-row');
    await expect(rows).toHaveCount(6);
    await expect(rows.last()).toContainText('Nothing executed yet'); // the owner hands work out
    await expect(page.getByTestId('how-scored-text')).toHaveCount(0);
    await page.getByTestId('how-scored').click();
    await expect(page.getByTestId('how-scored-text')).toContainText('Volume isn’t ranked');
  });
});
