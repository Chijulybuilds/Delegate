import { expect, test } from '@playwright/test';
import { card, choose, loginAs, resetDemo } from './helpers';

test.describe('Fair Insights', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('a task’s size is guessed from its title, and the size suggests a fair deadline', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByTestId('new-task').click();
    const title = page.getByTestId('task-title');
    await title.fill('Call the pastor about Sunday');
    await expect(page.getByTestId('task-size')).toHaveAttribute('data-value', 'xs');
    await title.fill('Edit the 1-hour conference video');
    await expect(page.getByTestId('task-size')).toHaveAttribute('data-value', 'l');
    await expect(page.getByText('A fair deadline for a large task.')).toBeVisible();
    await expect(page.getByTestId('task-due')).toContainText('18:00'); // tomorrow evening
    await page.getByTestId('task-submit').click();
    await card(page, 'Edit the 1-hour conference video').click();
    await expect(page.getByTestId('drawer-size')).toHaveAttribute('data-value', 'l');
    await choose(page, 'drawer-size', 'xl');
    await expect(page.getByText('Task updated')).toBeVisible();
  });

  test('Insights: complexity-weighted leaderboard, a size filter, and a day you can click into', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByRole('link', { name: 'Insights' }).click();
    const rows = page.getByTestId('leaderboard-row');
    await expect(rows).toHaveCount(6);
    await expect(rows.first().getByTestId('size-mix')).toBeVisible();
    await expect(rows.last()).toContainText('Nothing executed'); // the owner hands work out
    await page.getByTestId('how-scored').click();
    await expect(page.getByTestId('how-scored-text')).toContainText('Five video edits outweigh twenty-five phone calls');

    // One kind of work only.
    await choose(page, 'insights-size', 'l');
    await expect(page.getByTestId('leaderboard-scope')).toContainText('Large tasks only');
    await choose(page, 'insights-size', 'all');

    // One day: pick it from the calendar at the top, or click a bar.
    await page.getByTestId('insights-day').click();
    await page.getByTestId('insights-day-yesterday').click();
    await expect(page.getByTestId('insights-day')).toContainText(/\d+ \w{3}/);
    await expect(page.getByTestId('kpi-completed')).toContainText('Yesterday');
    await expect(page.getByTestId('leaderboard-scope')).toContainText('Yesterday');
    await expect(page.getByTestId('leaderboard-row').first()).not.toContainText('Nothing executed'); // someone executed work yesterday
    await page.getByTestId('insights-day').click();
    const marked = page.getByTestId('insights-day-panel').locator('button[data-day]:has(span)');
    await expect(marked.first()).toBeVisible(); // days with work carry a dot
    await marked.first().click();
    await expect(page).toHaveURL(/day=\d{4}-\d{2}-\d{2}/);
    await page.getByTestId('chart-day').nth(3).click();
    await expect(page).toHaveURL(/day=\d{4}-\d{2}-\d{2}/);
    await page.getByTestId('insights-day-clear').click();
    await expect(page.getByTestId('insights-day')).toContainText('All 14 days');
    await expect(page.getByTestId('leaderboard-scope')).toContainText('last 14 days');
  });

  test('only the owner sees Insights', async ({ page }) => {
    for (const persona of ['demo-kemi', 'demo-tunde']) {
      await loginAs(page, persona);
      await expect(page.getByRole('link', { name: 'Insights' })).toHaveCount(0);
      await page.goto('/app/insights?tab=velocity');
      await expect(page).toHaveURL(/\/app$/);
    }
  });
});
