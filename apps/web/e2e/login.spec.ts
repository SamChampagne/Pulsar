import { test, expect } from '@playwright/test';
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
    // A known nav element from the authenticated shell (apps/web/src/routes/(app)/+layout.svelte).
    await expect(page.getByRole('link', { name: 'Bureau des apps' })).toBeVisible();
  });
});
