import { expect, test } from '@playwright/test';
import { card, choose, loginAs, resetDemo } from './helpers';

test.describe('History and Audits', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('History: everyone sees their own earlier days (the owner sees all), laid out like Today, by day and time', async ({ page }) => {
    // Staff have a History too: only their own tasks from earlier days, with the same filters.
    await loginAs(page, 'demo-tunde');
    await expect(page.getByTestId('earlier-days')).toContainText('unfinished'); // their own leftovers
    await page.getByTestId('nav-waiting').click();
    await expect(page).toHaveURL(/\/app\/waiting/);
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await expect(page.getByTestId('task-card').first()).toBeVisible();
    await expect(page.getByTestId('task-card').filter({ hasNotText: 'Tunde' })).toHaveCount(0);
    await expect(page.getByTestId('waiting-filters-person')).toHaveCount(0); // no "everyone" filter for staff
    await page.getByTestId('waiting-filters-search').fill('CVE');
    await expect(page.getByTestId('task-card')).toHaveCount(1);
    await page.goto('/app/history'); // old links still work
    await expect(page).toHaveURL(/\/app\/waiting/);

    await loginAs(page, 'demo-ada');
    await expect(page.getByTestId('earlier-days')).toContainText('unfinished');
    await page.getByTestId('glance-waitingOnMe').click();
    await expect(page).toHaveURL(/\/app\/waiting/);
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

    // The same four lanes as Today, holding every earlier task.
    for (const id of ['open', 'active', 'done', 'approved']) await expect(page.getByTestId(`lane-${id}`)).toBeVisible();
    await expect(page.getByTestId('lane-count-approved')).toHaveText(/^1[1-9]$|^[2-9]\d$/);
    await expect(card(page, 'Finalize Q4 board deck')).toHaveCount(0); // today's work stays on Today
    await expect(page.getByTestId('task-day').first()).toBeVisible(); // several days: each card shows its day

    // Step to yesterday, then the day before.
    await page.getByTestId('day-prev').click();
    await expect(page.getByTestId('day-title')).toContainText('Yesterday');
    await expect(page.getByTestId('lane-done').locator(card(page, 'QA release 3.4 on Android'))).toBeVisible();
    await expect(card(page, 'Integrate SSO for enterprise pilot')).toHaveCount(0); // blocked: under Blocked, not on the lanes
    await expect(card(page, 'Renew domain and SSL certificates')).toHaveCount(0);
    await page.getByTestId('day-prev').click();
    await expect(page.getByTestId('day-title')).not.toContainText('Yesterday');
    await expect(page.getByTestId('lane-open').locator(card(page, 'Patch dependency CVE in image service'))).toBeVisible();
    await page.getByTestId('day-all').click();
    await expect(page.getByTestId('day-title')).toHaveText('All earlier days');

    // Time of day (workspace time): the demo hands work out around 08:00.
    await choose(page, 'waiting-filters-time', 'afternoon');
    await expect(page.getByTestId('task-card')).toHaveCount(0);
    await choose(page, 'waiting-filters-time', 'morning');
    await expect(page.getByTestId('task-card').first()).toBeVisible();

    // Search, then open a task: it still works from here.
    await page.getByTestId('waiting-filters-search').fill('CVE');
    await expect(page.getByTestId('task-card')).toHaveCount(1);
    await card(page, 'Patch dependency CVE in image service').click();
    await expect(page.getByTestId('drawer-title')).toHaveText('Patch dependency CVE in image service');
  });

  test('Blocked work leaves the lanes and waits on History → Blocked, where it can be unblocked or recalled', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    // Today's blocked task isn't on Today's lanes; the Blocked tile counts every day's.
    await expect(card(page, 'Negotiate courier contract renewal')).toHaveCount(0);
    await expect(page.getByTestId('earlier-days')).toContainText('2 blocked');
    await page.getByTestId('glance-blocked').click();
    await expect(page).toHaveURL(/view=blocked/);

    const blocked = page.getByTestId('lane-blocked');
    const courier = blocked.locator(card(page, 'Negotiate courier contract renewal')); // today
    const sso = blocked.locator(card(page, 'Integrate SSO for enterprise pilot')); // yesterday
    await expect(page.getByTestId('lane-count-blocked')).toHaveText('2');
    await expect(courier.getByTestId('task-day')).toHaveText('Today');
    await expect(courier.getByTestId('quick-recall')).toHaveCount(0); // already today's
    await expect(sso.getByTestId('quick-recall')).toBeVisible();

    // Unblock: back in motion on its own day.
    await courier.getByTestId('quick-unblock').click();
    await expect(page.getByText('Unblocked — it’s back in motion')).toBeVisible();
    await expect(courier).toHaveCount(0);

    // Recall: it leaves History entirely; a fresh copy is on today's board.
    await sso.getByTestId('quick-recall').click();
    await page.getByTestId('recall-confirm').click();
    await expect(page.getByText(/Recalled to today as DLG-\d+/)).toBeVisible();
    await expect(sso).toHaveCount(0);
    await expect(page.getByText('Nothing is blocked')).toBeVisible();
    await page.getByTestId('history-view-all').click();
    await expect(card(page, 'Integrate SSO for enterprise pilot')).toHaveCount(0);

    await page.getByTestId('nav-today').click();
    await expect(page.getByTestId('lane-active').locator(card(page, 'Negotiate courier contract renewal'))).toBeVisible();
    await expect(page.getByTestId('lane-open').locator(card(page, 'Integrate SSO for enterprise pilot'))).toBeVisible();
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
