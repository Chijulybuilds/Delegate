import { expect, test } from '@playwright/test';
import { card, choose, loginAs, resetDemo } from './helpers';

test.describe('Reassign', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('the owner hands a task in motion today to someone else', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    const onboarding = card(page, 'Ship onboarding email sequence v2');
    await expect(page.getByTestId('lane-active').locator(onboarding)).toBeVisible();
    await onboarding.getByTestId('quick-reassign').click();

    const modal = page.getByTestId('reassign-modal');
    await expect(modal.getByTestId('reassign-confirm')).toBeDisabled();
    await choose(page, 'reassign-to', 'demo-leo');
    await expect(modal.getByTestId('reassign-effect')).toContainText('goes back to Open');
    await modal.getByTestId('reassign-note').fill('Tunde is on the SSO pilot now.');
    await modal.getByTestId('reassign-confirm').click();
    await expect(page.getByText('Reassigned to Leo Martins')).toBeVisible();

    // Same task, same day: now Leo's, back in Open for him to start.
    const moved = page.getByTestId('lane-open').locator(onboarding);
    await expect(moved).toBeVisible();
    await expect(moved).toContainText('Leo');
    await expect(onboarding).toHaveCount(1); // gone from In motion
    await moved.click();
    await expect(page.getByText(/reassigned this task from Tunde Bakare to Leo Martins/)).toBeVisible();
    await expect(page.getByText('Tunde is on the SSO pilot now.')).toBeVisible();
  });

  test('History: unfinished cards can be reassigned or recalled; finished ones only recalled', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByTestId('nav-waiting').click();
    const cve = card(page, 'Patch dependency CVE in image service');
    await expect(cve.getByTestId('quick-reassign')).toBeVisible();
    await expect(cve.getByTestId('quick-recall')).toBeVisible();
    const audited = card(page, 'Renew domain and SSL certificates');
    await expect(audited.getByTestId('quick-recall')).toBeVisible();
    await expect(audited.getByTestId('quick-reassign')).toHaveCount(0);

    await cve.getByTestId('quick-reassign').click();
    await choose(page, 'reassign-to', 'demo-sara');
    await page.getByTestId('reassign-confirm').click();
    await expect(page.getByText('Reassigned to Sara Idowu')).toBeVisible();
    await expect(cve).toContainText('Sara'); // still in History, on its own day
  });

  test('from the task panel too, and staff never see it', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await card(page, 'Write job post for ops associate').click();
    await page.getByTestId('action-reassign').click();
    await choose(page, 'reassign-to', 'demo-kemi');
    await page.getByTestId('reassign-confirm').click();
    await expect(page.getByText('Reassigned to Kemi Adeyemi')).toBeVisible();
    await expect(page.getByTestId('drawer-title')).toHaveText('Write job post for ops associate');

    await loginAs(page, 'demo-tunde');
    await expect(card(page, 'Ship onboarding email sequence v2')).toBeVisible();
    await expect(page.getByTestId('quick-reassign')).toHaveCount(0);
  });
});
