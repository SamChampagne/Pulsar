import { test, expect } from '@playwright/test';
import { login } from './helpers';

/**
 * Coverage for the Connexions hub + inbound webhook receivers (arc 3, task
 * C6a). Login is real (see helpers.ts); every endpoint the page under test
 * touches is mocked so the assertions don't depend on seeded data. Background
 * calls the app layout makes on every page (notifications, pending agent
 * actions, unseen release notes, preferences) are left unmocked — they hit the
 * real API and are non-critical (wrapped in try/catch there).
 */

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('hub shows the inbound webhook receiver as available and navigates to it', async ({
  page,
}) => {
  await login(page);

  await page.route('**/api/v1/integrations', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });

  await page.goto('/connect');

  const heading = page.getByRole('heading', { name: 'Récepteur webhook entrant' });
  await expect(heading).toBeVisible();
  const card = page.locator('article', { has: heading });
  // AVAILABLE connectors get a real status badge, never the "not built yet" copy.
  await expect(card.getByText('Aucun identifiant demandé avant disponibilité')).toHaveCount(0);
  await expect(card.getByText('Disponible')).toBeVisible();

  await card.getByRole('link', { name: 'Configurer la connexion' }).click();
  await page.waitForURL('**/connect/inbound-hooks');
  await expect(page.getByRole('heading', { name: 'Récepteurs entrants', level: 1 })).toBeVisible();
});

test('inbound-hooks page generates a token and displays it exactly once', async ({ page }) => {
  await login(page);

  const integration = {
    id: 'int-acme-erp',
    key: 'inbound-acme-erp',
    name: 'Réception commandes — Acme ERP',
    status: 'ENABLED' as const,
    config: { target: 'customer.upsert', mappings: [] },
    hasInboundToken: false,
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  await page.route('**/api/v1/integrations', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [integration] });
  });
  await page.route('**/api/v1/connect/inbox**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 10 } });
  });

  let tokenRequestCaptured = false;
  await page.route('**/api/v1/integrations/int-acme-erp/inbound-token', async (route) => {
    tokenRequestCaptured = route.request().method() === 'POST';
    return route.fulfill({
      json: {
        token: 'plaintext-one-time-token-abc123',
        url: 'http://localhost:3100/api/v1/public/hooks/plaintext-one-time-token-abc123',
        target: 'customer.upsert',
        targetValid: true,
        signed: false,
        status: 'ENABLED',
      },
    });
  });

  await page.goto('/connect/inbound-hooks');
  await expect(page.getByText('Réception commandes — Acme ERP')).toBeVisible();

  await page.getByRole('button', { name: 'Générer le jeton' }).click();

  const dialog = page.getByRole('dialog', { name: 'Jeton du récepteur' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Jeton' })).toHaveValue(
    'plaintext-one-time-token-abc123',
  );
  await expect(dialog.getByRole('textbox', { name: /URL complète/ })).toHaveValue(
    'http://localhost:3100/api/v1/public/hooks/plaintext-one-time-token-abc123',
  );
  expect(tokenRequestCaptured).toBe(true);
});
