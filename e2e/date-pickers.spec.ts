import { expect, test } from '@playwright/test';
import { card, loginAs, resetDemo } from './helpers';

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

test.describe('Date and time pickers', () => {
  test.beforeEach(async ({ request }) => {
    await resetDemo(request);
  });

  test('a new task gets its due date from the calendar and the time columns', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-title').fill('Pick a due date the nice way');

    // A day in next month, at 16:30.
    const target = new Date();
    target.setDate(1);
    target.setMonth(target.getMonth() + 1);
    target.setDate(12);
    await page.getByTestId('task-due').click();
    const picker = page.getByTestId('task-due-picker');
    await picker.getByRole('button', { name: 'Next month' }).click();
    await picker.locator(`[data-day="${key(target)}"]`).click();
    await picker.getByTestId('task-due-hour-16').click();
    await picker.getByTestId('task-due-minute-30').click();
    await expect(picker).toContainText('16:30');
    await picker.getByTestId('task-due-done').click();
    await expect(page.getByTestId('task-due')).toContainText(`${target.getDate()} ${target.toLocaleDateString('en-GB', { month: 'short' })}, 16:30`);

    await page.getByTestId('task-submit').click();
    await card(page, 'Pick a due date the nice way').click();
    await expect(page.getByTestId('drawer-due')).toContainText('16:30');
  });

  test('quick picks, removing a date, and Esc inside the modal', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-due').click();
    await page.getByTestId('task-due-quick-tomorrow').click();
    await expect(page.getByTestId('task-due-picker')).toHaveCount(0);
    await expect(page.getByTestId('task-due')).toContainText('09:00');
    await expect(page.getByTestId('task-due')).toContainText('tomorrow');

    await page.getByTestId('task-due').click();
    await page.getByTestId('task-due-clear').click();
    await expect(page.getByTestId('task-due')).toContainText('No due date');

    // Esc closes the picker only; the modal stays.
    await page.getByTestId('task-due').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('task-due-picker')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Assign a task' })).toBeVisible();
  });

  test('editing a due date in the task drawer saves it', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await card(page, 'Write job post for ops associate').click();
    await page.getByTestId('drawer-due').click();
    await page.getByTestId('drawer-due-quick-monday').click();
    await expect(page.getByText('Task updated')).toBeVisible();
    await expect(page.getByTestId('drawer-due')).toContainText('Mon');
  });

  test('a playbook time is picked from chips or the columns', async ({ page }) => {
    await loginAs(page, 'demo-ada');
    await page.goto('/app/playbooks');
    await page.getByTestId('new-playbook').click();
    await page.getByTestId('playbook-time').click();
    await page.getByTestId('playbook-time-chip-17:00').click();
    await expect(page.getByTestId('playbook-time')).toContainText('17:00');
    await page.getByTestId('playbook-time').click();
    await page.getByTestId('playbook-time-hour-7').click();
    await page.getByTestId('playbook-time-minute-45').click();
    await page.getByTestId('playbook-time-done').click();
    await expect(page.getByTestId('playbook-time')).toContainText('07:45');
  });
});
