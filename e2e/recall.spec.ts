import { expect, test } from '@playwright/test';
import { card, choose, loginAs, resetDemo } from './helpers';

test.describe('Recall', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('the owner recalls an audited task from History to today, for someone else', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByTestId('nav-waiting').click();
    const audited = card(page, 'Renew domain and SSL certificates');
    await audited.getByTestId('quick-recall').click();

    const modal = page.getByTestId('recall-modal');
    await expect(modal).toContainText('audited, the record stays as it is');
    await choose(page, 'recall-assignee', 'demo-maya');
    await modal.getByTestId('recall-note').fill('Renew the staging certificate too.');
    await modal.getByTestId('recall-confirm').click();
    await expect(page.getByText(/Recalled to today as DLG-\d+/)).toBeVisible();

    // The original stays audited in History, marked as recalled, with no second recall.
    await page.keyboard.press('Escape');
    await expect(audited.getByTestId('chip-recalled-to')).toBeVisible();
    await expect(audited.getByTestId('quick-recall')).toHaveCount(0);

    // Today: a fresh, open copy for Maya, marked as recalled, with the note as its first message.
    await page.getByTestId('nav-today').click();
    const copy = card(page, 'Renew domain and SSL certificates');
    await expect(page.getByTestId('lane-open').locator(copy)).toBeVisible();
    await expect(copy).toContainText('Maya');
    await expect(copy.getByTestId('chip-recalled-from')).toBeVisible();
    await copy.click();
    await expect(page.getByTestId('recalled-from')).toBeVisible();
    await expect(page.getByText('Renew the staging certificate too.')).toBeVisible();
  });

  test('staff recall their own unfinished tasks together from the Recall page', async ({ page }) => {
    await loginAs(page, 'demo-tunde');
    await page.getByTestId('nav-recall').click();
    await expect(page.getByRole('heading', { name: 'Recall' })).toBeVisible();
    const rows = page.getByTestId('recall-row');
    await expect(rows).toHaveCount(2); // the blocked SSO task and the never-started CVE patch
    await expect(page.getByText('Executed', { exact: true })).toHaveCount(0); // no scopes for staff

    await page.getByTestId('recall-select-day').first().click();
    await page.getByTestId('recall-check').nth(1).click();
    await expect(page.getByTestId('recall-bar')).toContainText('2 selected');
    await page.getByTestId('recall-selected').click();
    await expect(page.getByText('Recalled 2 tasks to today')).toBeVisible();
    await expect(page.getByText('Nothing to recall')).toBeVisible();

    await page.getByTestId('nav-today').click();
    await expect(page.getByTestId('lane-open').locator(card(page, 'Integrate SSO for enterprise pilot'))).toBeVisible();
    await expect(page.getByTestId('lane-open').locator(card(page, 'Patch dependency CVE in image service'))).toBeVisible();
    await expect(page.getByTestId('earlier-days')).toHaveCount(0); // nothing left over any more
  });
});
