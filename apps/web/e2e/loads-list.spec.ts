import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * Authenticated smoke test: needs the NestJS API + a seeded database (see
 * apps/web/e2e/login.spec.ts) with the Transportation module enabled for the
 * demo tenant (default seed state).
 */
test.describe('loads list', () => {
  test('renders the PageHeader and either rows or the empty state', async ({ page }) => {
    await login(page);
    await page.goto('/loads');

    await expect(page.getByRole('heading', { name: 'Chargements' })).toBeVisible();

    // Either the table renders with a header row, or the empty-state copy shows
    // up inside it — either way proves the page fetched and rendered, not stuck
    // on a permanent skeleton/error.
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    const hasRows = (await table.getByRole('row').count()) > 1; // >1: header row + data
    const hasEmptyState = await page
      .getByText('Aucun load')
      .isVisible()
      .catch(() => false);
    expect(hasRows || hasEmptyState).toBe(true);
  });
});
