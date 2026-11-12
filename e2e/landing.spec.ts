import { expect, test } from '@playwright/test';

test.describe('Landing page', () => {
  test('hero, navigation and the hand-held cup render', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('The high-tempo execution');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('engine for lean teams');
    await expect(page.getByText('Real-time accountability')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pricing' })).toBeVisible();
    // The cup is decorative for assistive tech (aria-hidden stage) but must be on screen and loaded.
    const photo = page.getByTestId('cup-stage').locator('img[alt="A hand holding a Delegate coffee cup"]');
    await expect(photo).toBeVisible();
    expect(await photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('the cup walks through the four task states as you scroll', async ({ page }) => {
    await page.goto('/');
    const ticket = page.getByTestId('cup-stage').locator('text');
    const how = await page.evaluate(() => {
      const el = document.getElementById('how')!;
      return { top: el.getBoundingClientRect().top + scrollY, height: el.offsetHeight, vh: innerHeight };
    });
    const range = how.height - how.vh;
    const expectations: Array<[number, string]> = [
      [0.1, 'Open'],
      [0.37, 'In progress'],
      [0.62, 'Executed'],
      [0.9, 'Audited ✓'],
    ];
    for (const [p, label] of expectations) {
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(how.top + range * p));
      await expect(ticket.filter({ hasText: label }).first()).toBeAttached();
    }
    // The matching step is highlighted in the copy as well.
    await expect(page.locator('#how li[data-active="true"]')).toContainText('Audited');
  });

  test('the cup never covers the hero copy and never slides under the footer', async ({ page }) => {
    const geometry = () =>
      page.evaluate(() => {
        const img = document.querySelector('[data-testid="cup-stage"] img')!.getBoundingClientRect();
        const at = (fraction: number) => img.top + img.height * fraction;
        return {
          steamTop: at(22 / 1278),
          cupBottom: at(815 / 1278),
          handEnd: at(0.86),
          copyBottom: document.getElementById('hero-copy')!.getBoundingClientRect().bottom,
          footerTop: document.querySelector('footer')!.getBoundingClientRect().top,
          vh: window.innerHeight,
        };
      });

    for (const size of [{ width: 1918, height: 923 }, { width: 1366, height: 650 }]) {
      await page.setViewportSize(size);
      await page.goto('/');
      // Hero: steam starts below the headline + pills, and the whole cup is above the fold.
      await expect.poll(async () => {
        const g = await geometry();
        return g.steamTop >= g.copyBottom - 2 && g.cupBottom <= g.vh;
      }, { timeout: 8000 }).toBe(true);
      // Bottom of the page: the hand ends above the footer instead of sliding under it.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(async () => {
        const g = await geometry();
        return g.handEnd <= g.footerTop + 1;
      }, { timeout: 8000 }).toBe(true);
    }
  });

  test('sections and pricing are present', async ({ page }) => {
    await page.goto('/');
    for (const id of ['how', 'product', 'preview', 'pricing', 'start']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect(page.getByText('$8', { exact: true })).toBeVisible();
    await page.locator('#start').scrollIntoViewIfNeeded();
    await expect(page.getByRole('heading', { name: /Hand it off/ })).toBeVisible();
  });

  test('Get started leads to sign-up', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Get started' }).click();
    await expect(page).toHaveURL(/\/login\?intent=signup/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Start handing');
  });

  test('the admin console is never linked from the public site or sign-in', async ({ page }) => {
    for (const path of ['/', '/login', '/login?intent=signup']) {
      await page.goto(path);
      await expect(page.locator('a[href*="admin"]')).toHaveCount(0);
      await expect(page.getByText(/admin console/i)).toHaveCount(0);
    }
  });
});
