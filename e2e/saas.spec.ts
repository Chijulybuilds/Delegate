import { expect, test } from '@playwright/test';
import { card, choose, loginAs, resetDemo } from './helpers';

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
    await choose(page, 'playbook-cadence', 'weekly');
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

  test('news about a task shows as a red badge on its card (with the Delegate sound), not in the bell', async ({ page, request }) => {
    const title = `Book the venue ${Date.now().toString(36)}`;
    await loginAs(page, 'demo-ada');
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-title').fill(title);
    await choose(page, 'task-assignee', 'demo-tunde');
    await page.getByTestId('task-submit').click();
    await expect(card(page, title)).toBeVisible();

    await loginAs(page, 'demo-tunde');
    const mine = card(page, title);
    await expect(mine.getByTestId('task-news')).toHaveText('1');
    await expect(page.getByTestId('nav-news-today')).toHaveText('1');
    // The bell only points at the badge; it doesn't list task news itself.
    await expect(page.locator('[data-testid="bell-count"]:visible')).toHaveCount(0);
    await page.locator('[data-testid="bell"]:visible').click();
    await expect(page.getByTestId('bell-task-news')).toContainText('red badge');
    await page.keyboard.press('Escape');

    // Ada writes on the task while Tunde is looking at his board: the badge counts up and the chime plays.
    await page.mouse.click(5, 5); // a click lets the browser play sound
    const before = await page.evaluate(() => document.documentElement.dataset.notifySound ?? '');
    const ada = (await (await request.post('/api/auth/demo', { data: { personaId: 'demo-ada' } })).json()).token;
    const tasks = (await (await request.get('/api/tasks', { headers: { Authorization: `Bearer ${ada}` } })).json()).tasks as Array<{ id: string; title: string }>;
    const taskId = tasks.find((t) => t.title === title)!.id;
    await request.post(`/api/tasks/${taskId}/comments`, { headers: { Authorization: `Bearer ${ada}` }, data: { body: 'Can you book it for Friday?' } });
    await expect(mine.getByTestId('task-news')).toHaveText('2', { timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.notifySound ?? '')).not.toBe(before);

    // Opening the task reads it: the badge goes away and stays away.
    await mine.click();
    await expect(page.getByTestId('drawer-title')).toHaveText(title);
    await page.keyboard.press('Escape');
    await expect(mine.getByTestId('task-news')).toHaveCount(0);
    await page.reload();
    await expect(card(page, title)).toBeVisible();
    await expect(card(page, title).getByTestId('task-news')).toHaveCount(0);
  });

  test('the notification sound can be switched off', async ({ page }) => {
    await loginAs(page, 'demo-tunde');
    await page.getByTestId('user-menu').click();
    const toggle = page.getByTestId('sound-toggle');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => localStorage.getItem('delegate.sound'))).toBe('off');
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
