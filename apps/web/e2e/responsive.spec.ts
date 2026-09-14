import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * Tablet-viewport check (runs under the `tablet` Playwright project — iPad).
 * The authenticated app shell must remain usable at a narrow width: it renders,
 * doesn't crash, and the page does not scroll horizontally (a common regression
 * when a fixed-width table or panel overflows the viewport).
 */
test.describe('responsive app shell (tablet)', () => {
  test('dashboard renders and does not overflow horizontally', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Centre des opérations' })).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);

    // No horizontal scroll: the document is not wider than the viewport.
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1); // allow sub-pixel rounding
  });
});
