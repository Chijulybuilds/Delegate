import { expect, test } from '@playwright/test';
import { card, choose, lane, loginAs, resetDemo } from './helpers';

const sel = (title: string) => `[data-testid="task-card"][data-task-title="${title}"]`;

test.describe.serial('Accountability loop: Red → Amber → Green → Blue ✓', () => {
  const title = `Send Q4 vendor summary ${Date.now().toString(36)}`;

  test.beforeAll(async ({ request }) => {
    await resetDemo(request);
  });

  test('a manager assigns a task — it lands red', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-title').fill(title);
    await page.getByLabel('Brief').fill('One-page summary of all Q4 vendor spend, sent to finance.');
    await choose(page, 'task-assignee', 'demo-tunde');
    await page.getByTestId('task-submit').click();
    await expect(lane(page, 'open').locator(sel(title))).toBeVisible();
    await expect(card(page, title)).toHaveAttribute('data-status', 'open');
  });

  test('the assignee starts it (amber) and submits proof (green)', async ({ page }) => {
    await loginAs(page, 'demo-tunde');
    const c = card(page, title);
    await expect(c.getByTestId('quick-approve')).toHaveCount(0);
    await c.getByTestId('quick-start').click();
    await expect(lane(page, 'active').locator(sel(title))).toBeVisible();

    await c.getByTestId('quick-submit').click();
    await expect(page.getByTestId('proof-form')).toBeVisible();
    // Proof is mandatory.
    await page.getByTestId('proof-submit').click();
    await expect(page.getByText('Add a link, a note or a file as proof')).toBeVisible();

    await page.getByTestId('proof-url').fill('https://docs.example.com/q4-vendor-summary');
    await page.getByTestId('proof-note').fill('Summary sent to finance — 12 vendors, 3 flagged for renegotiation.');
    await page.getByTestId('proof-submit').click();
    await expect(page.getByTestId('proof-list')).toContainText('docs.example.com/q4-vendor-summary');
    await page.keyboard.press('Escape');
    await expect(lane(page, 'done').locator(sel(title))).toBeVisible();
  });

  test('the manager audits it — blue, sealed in the ledger', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await card(page, title).getByTestId('quick-approve').click();
    await expect(lane(page, 'approved').locator(sel(title))).toBeVisible();
    // Once the lane-change animation settles there is exactly one card, and it is blue.
    await expect(card(page, title)).toHaveCount(1);
    await expect(card(page, title)).toHaveAttribute('data-status', 'approved');

    await page.getByRole('link', { name: 'Activity' }).click();
    await expect(page.getByTestId('heartbeat-list').first()).toContainText(`audited and closed “${title}”`);
    await expect(page.getByTestId('heartbeat-list').first()).toContainText(`Tunde Bakare submitted proof “${title}”`);
  });

  test('task history is recorded in order in the drawer', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await card(page, title).click();
    await expect(page.getByTestId('drawer-title')).toHaveText(title);
    const activity = page.getByRole('dialog', { name: 'Task details' });
    await expect(activity).toContainText('Ada Okafor audited and closed');
    await expect(activity).toContainText('Tunde Bakare started');
    await expect(activity).toContainText('Ada Okafor assigned');
  });
});

test.describe('Collaboration', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('Blocker Ping reaches the teammate being waited on', async ({ page }) => {
    await loginAs(page, 'demo-maya');
    await card(page, 'Write job post for ops associate').click();
    await page.getByTestId('action-block').click();
    await page.getByTestId('block-reason').fill('Need the approved salary band before posting.');
    await choose(page, 'block-waiting-on', 'demo-kemi');
    await page.getByTestId('block-submit').click();
    await expect(page.getByTestId('action-unblock')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card(page, 'Write job post for ops associate')).toHaveCount(1);
    await expect(card(page, 'Write job post for ops associate')).toHaveAttribute('data-status', 'blocked');

    await loginAs(page, 'demo-kemi');
    const banner = page.getByTestId('blocker-banner');
    await expect(banner).toContainText('waiting on you');
    await expect(banner).toContainText('Write job post for ops associate');
  });

  test('micro-chat stays attached to the task', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await card(page, 'Finalize Q4 board deck').click();
    await page.getByTestId('chat-input').fill('Looks sharp — send it to the board by five.');
    await page.getByTestId('chat-input').press('Enter');
    await expect(page.getByTestId('chat-list')).toContainText('Looks sharp — send it to the board by five.');
  });

  test('filters narrow the board without losing it', async ({ page }) => {
    await loginAs(page, 'demo-tunde');
    await page.getByRole('tab', { name: 'Mine' }).click();
    // Cards that leave animate out; wait for the board to settle on Tunde's work only.
    await expect(page.getByTestId('task-card').filter({ hasNotText: 'Tunde' })).toHaveCount(0);
    await expect(page.getByTestId('task-card').filter({ hasText: 'Tunde' }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Everyone' }).click();
    await expect(page.getByTestId('task-card').filter({ hasText: 'Maya' }).first()).toBeVisible();
  });

  test('Velocity Pulse and Standup-in-a-Box render from the ledger', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByRole('link', { name: 'Insights' }).click();
    await expect(page.getByTestId('kpi-completed')).toBeVisible();
    await expect(page.getByTestId('velocity-table').locator('tbody tr')).toHaveCount(6);
    await page.getByRole('tab', { name: 'Standup' }).click();
    const brief = page.getByTestId('standup-brief');
    await expect(brief).toContainText('Blockers');
    await expect(brief).toContainText('Negotiate courier contract renewal');
  });
});

test.describe('Sign-up and onboarding', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('protected routes send visitors to sign in', async ({ page }) => {
    await page.goto('/app/velocity');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a new company creates a workspace and assigns its first task', async ({ page }) => {
    await page.goto('/login?intent=signup');
    await page.getByLabel('Full name').fill('Chidi Nwosu');
    await page.getByLabel('Work email').fill(`chidi.${Date.now()}@northstar.example`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL('**/onboarding');
    await page.getByLabel('Company or team name').fill('Northstar Logistics');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.waitForURL('**/app');
    await expect(page.getByTestId('workspace-name')).toHaveText('Northstar Logistics');
    await expect(page.getByText('Your board is empty')).toBeVisible();

    await page.getByTestId('new-task').click();
    await page.getByTestId('task-title').fill('Map the delivery routes for December');
    await page.getByTestId('task-submit').click();
    await expect(card(page, 'Map the delivery routes for December')).toBeVisible();

    await page.getByRole('link', { name: 'Team', exact: true }).click();
    await expect(page.getByTestId('invite-code')).toHaveText(/^NORTHS-[A-Z0-9]{4}$/);
  });

  test('a teammate joins with the invite code', async ({ page }) => {
    await page.goto('/login?intent=signup');
    await page.getByLabel('Full name').fill('Bisi Ade');
    await page.getByLabel('Work email').fill(`bisi.${Date.now()}@lumen.example`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForURL('**/onboarding');
    await page.getByLabel('Invite code').fill('LUMEN-2026');
    await page.getByRole('button', { name: 'Join workspace' }).click();
    await page.waitForURL('**/app');
    await expect(page.getByTestId('workspace-name')).toHaveText('Lumen & Co.');
    await expect(card(page, 'Finalize Q4 board deck')).toBeVisible();
    // Staff cannot assign work to other people.
    await page.getByTestId('new-task').click();
    await expect(page.getByTestId('task-assignee')).toBeDisabled();
  });
});
