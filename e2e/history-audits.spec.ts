import { expect, test } from '@playwright/test';
import { choose, loginAs, resetDemo } from './helpers';

test.describe('History and Audits', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('earlier days live in History: grouped by day, filterable, still workable', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    // Today's board only holds today's work; it points at what's still open from earlier days.
    await expect(page.getByTestId('earlier-days')).toContainText('unfinished');
    await page.getByTestId('earlier-days').click();
    await expect(page).toHaveURL(/\/app\/history/);

    const rows = page.getByTestId('history-row');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByTestId('history-list')).toContainText('Yesterday');

    // Search by words from the title.
    await page.getByTestId('history-filters-search').fill('SSO');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-task-title', 'Integrate SSO for enterprise pilot');
    await expect(page).toHaveURL(/q=SSO/); // filters live in the address bar

    // Reset, then filter by status and priority.
    await page.getByTestId('history-filters-reset').click();
    await choose(page, 'history-filters-status', 'approved');
    await expect(rows.first()).toBeVisible();
    await expect(page.locator('[data-testid="history-row"]:not([data-status="approved"])')).toHaveCount(0);
    await choose(page, 'history-filters-priority', 'urgent');
    await expect(rows.filter({ hasNotText: /urgent/i })).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Prepare weekly payroll export' })).toHaveCount(1);
    await expect(page.locator('[data-testid="history-row"]:not([data-status="approved"])')).toHaveCount(0);

    // Date range: "Yesterday" only.
    await page.getByTestId('history-filters-reset').click();
    await page.getByTestId('history-filters-dates').click();
    await page.getByTestId('history-filters-dates-preset-yesterday').click();
    await expect(page.getByTestId('history-filters-dates')).toContainText('Yesterday');
    await expect(page.locator('[data-testid="history-list"] h2')).toHaveCount(1);

    // Tasks from earlier days still open and can be worked on.
    await page.getByTestId('history-filters-reset').click();
    await page.getByTestId('history-filters-search').fill('CVE');
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('history-filters-dates')).toContainText('All dates'); // Reset really cleared the dates
    await rows.first().click();
    await expect(page.getByTestId('drawer-title')).toHaveText('Patch dependency CVE in image service');
  });

  test('Audits: owner only, searchable, filterable, downloadable', async ({ page }) => {
    await loginAs(page, 'demo-tunde');
    await expect(page.getByTestId('nav-audits')).toHaveCount(0);
    await page.goto('/app/audits');
    await expect(page).toHaveURL(/\/app$/); // staff are sent back to their board

    await loginAs(page, 'demo-ada');
    await page.getByTestId('nav-audits').click();
    await expect(page.getByRole('heading', { name: 'Audits' })).toBeVisible();
    await expect(page.getByTestId('audits-total')).toHaveText(/^\d+$/);
    const total = Number(await page.getByTestId('audits-total').textContent());
    expect(total).toBeGreaterThanOrEqual(11);

    const rows = page.getByTestId('audit-row');
    await choose(page, 'audit-filters-priority', 'urgent');
    await expect(rows.first()).toBeVisible();
    await expect(rows.filter({ hasNotText: /urgent/i })).toHaveCount(0);

    await page.getByTestId('audit-filters-reset').click();
    await choose(page, 'audit-filters-person', 'demo-sara');
    await expect(rows.first()).toBeVisible();
    await expect(rows.filter({ hasNotText: 'Sara Idowu' })).toHaveCount(0);

    await page.getByTestId('audit-filters-search').fill('walkthrough');
    await expect(rows).toHaveCount(1);
    const download = page.waitForEvent('download');
    await page.getByTestId('audits-download').click();
    expect((await download).suggestedFilename()).toMatch(/^delegate-audits-.*\.csv$/);

    await rows.first().click();
    await expect(page.getByTestId('drawer-title')).toHaveText('Record product walkthrough video');
  });
});
