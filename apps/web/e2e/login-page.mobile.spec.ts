import { test, expect } from './fixtures';

/**
 * Mobile-viewport check (runs under the `mobile-chromium` project — Pixel 5).
 * Public pages must be usable on a phone. /login is a plain SPA route that does
 * not call the API until submit, so this passes with the backend down — it
 * proves the mobile shell renders and does not scroll horizontally.
 */
test.describe('login page (mobile)', () => {
  test('renders the sign-in form without horizontal overflow', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);

    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
