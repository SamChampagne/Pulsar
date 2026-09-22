import { test, expect } from './fixtures';
import { login } from './helpers';

/**
 * Authenticated smoke test: needs the NestJS API + a seeded database
 * reachable through the web dev server's `/api` proxy (pnpm db:up, db:migrate,
 * db:seed, and the API running — see apps/web/playwright.config.ts).
 */
test.describe('login flow', () => {
  test('signs in and lands on the dashboard', async ({ page }) => {
    await login(page);

    await expect(page).toHaveURL(/\/dashboard$/);
    // The authenticated landing renders the operations centre heading — a stable
    // signal that login succeeded and the app shell mounted.
    await expect(page.getByRole('heading', { name: 'Centre des opérations' })).toBeVisible();
  });
});
