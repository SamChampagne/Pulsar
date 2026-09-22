import { test, expect, type Page } from './fixtures';
import { login } from './helpers';

/**
 * Authenticated journey smoke tests (desktop). Needs the NestJS API + a seeded
 * database reachable through the web server's /api proxy (dev) or preview proxy
 * (CI). Each journey proves the surface fetched and rendered — a visible heading
 * and NO Vite error overlay (which SvelteKit/Vite injects on an uncaught client
 * exception). Robust by construction: tolerant of empty states, accessible
 * selectors only, no arbitrary waits.
 */

/** Fails the test if the page rendered Vite's uncaught-exception overlay. */
async function assertNoCrash(page: Page) {
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  // At least one heading rendered — proves the route mounted, not a blank shell.
  await expect(page.getByRole('heading').first()).toBeVisible();
}

test.describe('operational journeys', () => {
  test('dashboard renders the operations centre', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Centre des opérations' })).toBeVisible();
    await assertNoCrash(page);
  });

  test('transport orders list renders', async ({ page }) => {
    await login(page);
    await page.goto('/transport-orders');
    await assertNoCrash(page);
  });

  test('sales orders list renders (CRM)', async ({ page }) => {
    await login(page);
    await page.goto('/crm/sales-orders');
    await assertNoCrash(page);
  });

  test('WMS overview renders', async ({ page }) => {
    await login(page);
    await page.goto('/wms');
    await assertNoCrash(page);
  });

  test('yard board renders', async ({ page }) => {
    await login(page);
    await page.goto('/yard');
    await assertNoCrash(page);
  });

  test('fleet overview renders', async ({ page }) => {
    await login(page);
    await page.goto('/fleet');
    await assertNoCrash(page);
  });

  test('agents roster renders', async ({ page }) => {
    await login(page);
    await page.goto('/agents');
    await assertNoCrash(page);
  });

  test('carrier invoices (freight audit surface) renders', async ({ page }) => {
    await login(page);
    await page.goto('/invoices');
    await assertNoCrash(page);
  });

  test('manufacturing scheduling (Gantt) renders without crashing', async ({ page }) => {
    await login(page);
    await page.goto('/manufacturing/scheduling');
    await assertNoCrash(page);
  });
});
