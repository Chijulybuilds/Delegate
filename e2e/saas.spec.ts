import { expect, test } from '@playwright/test';
import { card, loginAs, resetDemo } from './helpers';

/**
 * The SaaS layer, end to end, in demo mode: providers are simulated by the server
 * (no Stripe, Paystack, Slack or Meta accounts needed), but every request goes through
 * the same routes, entitlement checks and ledger as production.
 */
test.describe('SaaS layer', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('a new workspace starts on a trial and upgrades through checkout', async ({ page }) => {
    await page.goto('/login?intent=signup');
    await page.getByLabel('Full name').fill('Amaka Eze');
    await page.getByLabel('Work email').fill(`amaka.${Date.now()}@harbour.example`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL('**/onboarding');
    await page.getByLabel('Company or team name').fill('Harbour Foods');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.waitForURL('**/app');
    // The trial is quiet at first (the banner only appears in the last week).
    await expect(page.getByTestId('plan-card')).toContainText('Team trial · 14d left');
    await expect(page.getByTestId('trial-banner')).toHaveCount(0);

    await page.getByTestId('plan-card').click();
    await expect(page).toHaveURL(/tab=billing/);
    await expect(page.getByTestId('billing-status')).toHaveText('Trial');
    await page.getByTestId('upgrade-stripe').click();
    await expect(page.getByRole('dialog', { name: 'Simulated Stripe checkout' })).toBeVisible();
    await page.getByTestId('demo-pay').click();
    await expect(page.getByTestId('billing-status')).toHaveText('Active');
    await expect(page.getByTestId('plan-card')).toContainText('Team plan');
  });

  test('WhatsApp: switch on, then list and create tasks from a chat', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.goto('/app/settings?tab=integrations');
    await expect(page.getByTestId('whatsapp-status')).toHaveText('Not connected');
    await page.getByTestId('whatsapp-toggle').click();
    await expect(page.getByTestId('whatsapp-status')).toHaveText('Connected');

    const sim = page.getByTestId('whatsapp-simulator');
    await sim.getByTestId('wa-input').fill('list');
    await sim.getByTestId('wa-send').click();
    await expect(sim.getByTestId('wa-reply').last()).toContainText('Nothing on your plate');

    await sim.getByTestId('wa-input').fill('new Approve the March payroll today');
    await sim.getByTestId('wa-send').click();
    await expect(sim.getByTestId('wa-reply').last()).toContainText('for you');
    await sim.getByTestId('wa-input').fill('list');
    await sim.getByTestId('wa-send').click();
    await expect(sim.getByTestId('wa-reply').last()).toContainText(/DLG-\d+.*Approve the March payroll/);

    await sim.getByTestId('wa-input').fill('new Restock printer paper @Tunde tomorrow !high');
    await sim.getByTestId('wa-send').click();
    await expect(sim.getByTestId('wa-reply').last()).toContainText('Created DLG-');
    await expect(sim.getByTestId('wa-reply').last()).toContainText('Tunde Bakare');

    await page.getByRole('link', { name: 'Today' }).click();
    const c = card(page, 'Restock printer paper');
    await expect(c).toBeVisible();
    await expect(c).toContainText('WhatsApp');
  });

  test('Slack connects, sends a test and logs the delivery; GitHub issues a webhook', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.goto('/app/settings?tab=integrations');
    await page.getByTestId('slack-connect').click();
    await expect(page.getByTestId('slack-status')).toHaveText('Connected');
    await expect(page.getByTestId('slack')).toContainText('#delegate');
    await page.getByTestId('slack-test').click();
    await expect(page.getByTestId('deliveries')).toContainText('Delegate is connected');

    await page.getByTestId('github-connect').click();
    const secret = page.getByTestId('github-secret');
    await expect(secret).toContainText('/api/hooks/github/');
    await expect(page.getByTestId('github-status')).toHaveText('Connected');
  });

  test('a playbook creates its tasks on demand', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByRole('link', { name: 'Playbooks' }).click();
    await page.getByTestId('new-playbook').click();
    const form = page.getByTestId('playbook-form');
    await form.getByTestId('playbook-name').fill('Friday close-out');
    await form.getByTestId('playbook-cadence').selectOption('weekly');
    await form.getByTestId('playbook-item-title').first().fill('Reconcile the petty cash box');
    await form.getByTestId('playbook-save').click();
    const pb = page.getByTestId('playbook-card').filter({ hasText: 'Friday close-out' });
    await expect(pb).toBeVisible();
    await pb.getByTestId('playbook-run').click();

    await page.getByRole('link', { name: 'Today' }).click();
    const c = card(page, 'Reconcile the petty cash box');
    await expect(c).toBeVisible();
    await expect(c).toContainText('Playbook');
  });

  test('assignment notifications ring the bell', async ({ page }) => {
    const title = `Book the venue ${Date.now().toString(36)}`;
    await loginAs(page, 'demo-ada');
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-title').fill(title);
    await page.getByTestId('task-assignee').selectOption('demo-tunde');
    await page.getByTestId('task-submit').click();
    await expect(card(page, title)).toBeVisible();

    await loginAs(page, 'demo-tunde');
    // The bell lives in the sidebar on desktop and in the top bar on phones.
    await expect(page.locator('[data-testid="bell-count"]:visible')).toHaveText('1');
    await page.locator('[data-testid="bell"]:visible').click();
    const panel = page.getByTestId('bell-panel');
    await expect(panel).toContainText(title);
    await panel.getByText(title).first().click();
    await expect(page.getByTestId('drawer-title')).toHaveText(title);
  });

  test('glance numbers filter the board', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    const toAudit = page.getByTestId('glance-toAudit');
    const n = Number(await toAudit.locator('span').last().textContent());
    expect(n).toBeGreaterThan(0);
    await toAudit.click();
    await expect(toAudit).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('task-card')).toHaveCount(n);
    await expect(page.getByTestId('task-card').first()).toHaveAttribute('data-status', 'done');
    await toAudit.click();
    await expect(page.locator('[data-testid="task-card"][data-status="open"]').first()).toBeVisible();
  });

  test('automations save and run on demand; old links redirect', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.goto('/app/settings?tab=automations');
    await page.getByLabel('Alert managers after').fill('2');
    await page.getByTestId('escalation-form').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Automations saved')).toBeVisible();
    await page.getByTestId('run-automations').click();
    await expect(page.getByText(/Checked: \d+ escalation/)).toBeVisible();

    await page.goto('/app/velocity');
    await expect(page).toHaveURL(/\/app\/insights\?tab=velocity/);
    await expect(page.getByTestId('kpi-completed')).toBeVisible();
  });
});
