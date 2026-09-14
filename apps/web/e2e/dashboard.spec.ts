import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * Authenticated smoke test: needs the NestJS API + a seeded database (see
 * apps/web/e2e/login.spec.ts for the same requirement).
 */
test.describe('dashboard', () => {
  test('loads without crashing', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Centre des opérations' })).toBeVisible();
    // No uncaught error boundary / stack trace leaking onto the page (Vite's dev
    // overlay renders this custom element on an unhandled client-side exception).
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  });
});
