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

/**
 * Coverage for the EDI partners page (arc 3, task C6b). The client-side 204
 * preview runs entirely through `@pulsar/shared/edi` in the browser — no
 * network call — while "Envoyer un 204" goes through the real API contract
 * (`POST /connect/edi/inbound`, JSON `{ integrationKey, content }`).
 */

const EDI_PARTNER = {
  id: 'int-edi-acme',
  key: 'edi-acme-shipper',
  name: 'Acme Shipper — EDI',
  status: 'ENABLED' as const,
  config: {
    isaSenderId: 'PULSARTMS',
    isaReceiverId: 'ACMESHIPPER',
    gsSenderId: 'PULSARTMS',
    gsReceiverId: 'ACMESHIPPER',
    customerId: 'cust-1',
    carrierId: '',
    url: '',
    format: 'x12',
  },
  hasInboundToken: false,
  createdAt: '2026-09-01T00:00:00.000Z',
};

test('EDI page lists a partner and previews a pasted 204 client-side', async ({ page }) => {
  await login(page);

  await page.route('**/api/v1/integrations', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [EDI_PARTNER] });
  });
  await page.route('**/api/v1/connect/inbox**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 10 } });
  });

  await page.goto('/connect/edi');

  await expect(page.getByRole('article').getByText('Acme Shipper — EDI')).toBeVisible();
  await expect(page.getByText('edi-acme-shipper')).toBeVisible();

  // The preview textarea comes pre-filled with a valid sample 204 — decoding
  // it is a pure client-side call, no request is made.
  await page.getByRole('button', { name: 'Décoder' }).click();

  await expect(page.getByRole('cell', { name: 'ACME MANUFACTURING' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'LOBLAW DC TORONTO' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'MONTREAL' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'TORONTO', exact: true })).toBeVisible();
});

test('"Envoyer un 204" posts to /connect/edi/inbound and shows the mocked 990 ack', async ({
  page,
}) => {
  await login(page);

  await page.route('**/api/v1/integrations', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [EDI_PARTNER] });
  });
  await page.route('**/api/v1/connect/inbox**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 10 } });
  });

  let capturedContentType = '';
  let capturedBody: { integrationKey?: string; content?: string } | null = null;
  await page.route('**/api/v1/connect/edi/inbound', async (route) => {
    const req = route.request();
    capturedContentType = req.headers()['content-type'] ?? '';
    capturedBody = req.postDataJSON();
    return route.fulfill({
      json: {
        inboxId: 'inbox-1',
        status: 'IMPORTED',
        summary: 'Commande TO-000123 créée',
        transactionSetId: '204',
        entityType: 'transport-order',
        entityId: 'to-123',
        ack: 'ISA*00*...~GS*GF*ACMESHIPPER*PULSARTMS*20260917*0905*1*X*004010~ST*990*0001~B1*CRXY*SHP-2026-0043*20260917*A~SE*3*0001~GE*1*1~IEA*1*000000001~',
      },
    });
  });

  await page.goto('/connect/edi');
  await expect(page.getByRole('article').getByText('Acme Shipper — EDI')).toBeVisible();

  await page.getByRole('button', { name: 'Envoyer un 204' }).click();

  const dialog = page.getByRole('dialog', { name: 'Envoyer un 204' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Envoyer' }).click();

  await expect(dialog.getByText('Importé')).toBeVisible();
  await expect(dialog.locator('pre')).toContainText('ST*990*0001');

  expect(capturedContentType).toContain('application/json');
  expect(capturedBody?.integrationKey).toBe('edi-acme-shipper');
  expect(capturedBody?.content ?? '').toContain('ISA*00*');
});

test('creating a partner omits blank envelope ids so the server default applies', async ({
  page,
}) => {
  await login(page);

  let capturedCreateBody: { key?: string; name?: string; config?: Record<string, unknown> } | null =
    null;

  await page.route('**/api/v1/integrations', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: [] });
    if (req.method() === 'POST') {
      capturedCreateBody = req.postDataJSON();
      return route.fulfill({
        json: {
          id: 'int-edi-new',
          key: capturedCreateBody?.key,
          name: capturedCreateBody?.name,
          status: 'ENABLED',
          config: capturedCreateBody?.config,
          hasInboundToken: false,
          createdAt: '2026-09-17T00:00:00.000Z',
        },
      });
    }
    return route.fallback();
  });
  await page.route('**/api/v1/connect/inbox**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 10 } });
  });

  await page.goto('/connect/edi');

  await page.getByRole('button', { name: 'Nouveau partenaire EDI' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau partenaire EDI' });
  await expect(dialog).toBeVisible();

  // Only the name is filled — every ISA/GS id and the outbound URL stay blank.
  await dialog.getByRole('textbox', { name: 'Nom' }).fill('Contoso Freight — EDI');
  await dialog.getByRole('button', { name: 'Créer le partenaire' }).click();

  await expect(dialog).toBeHidden();
  expect(capturedCreateBody?.config?.format).toBe('x12');
  expect(capturedCreateBody?.config?.gsSenderId).toBeUndefined();
  expect(capturedCreateBody?.config?.gsReceiverId).toBeUndefined();
  expect(capturedCreateBody?.config?.isaSenderId).toBeUndefined();
  expect(capturedCreateBody?.config?.isaReceiverId).toBeUndefined();
  expect(capturedCreateBody?.config?.url).toBeUndefined();
});

test('editing a partner sends null for a cleared envelope id (PATCH merge semantics)', async ({
  page,
}) => {
  await login(page);

  let capturedPatchBody: { name?: string; config?: Record<string, unknown> } | null = null;

  await page.route('**/api/v1/integrations', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [EDI_PARTNER] });
  });
  await page.route('**/api/v1/integrations/int-edi-acme', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    capturedPatchBody = route.request().postDataJSON();
    return route.fulfill({
      json: { ...EDI_PARTNER, name: capturedPatchBody?.name, config: capturedPatchBody?.config },
    });
  });
  await page.route('**/api/v1/connect/inbox**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 10 } });
  });

  await page.goto('/connect/edi');
  await expect(page.getByRole('article').getByText('Acme Shipper — EDI')).toBeVisible();

  await page.getByRole('button', { name: 'Modifier' }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifier le partenaire EDI' });
  await expect(dialog).toBeVisible();

  // GS02 was previously set ('PULSARTMS') — clearing it must delete the key
  // (PATCH now merges: an omitted key is left untouched, so a clear has to be
  // sent explicitly as `null`), while the untouched ISA06 field ('PULSARTMS')
  // is resent as-is and the already-blank URL stays omitted.
  await dialog.getByRole('textbox', { name: /GS02/ }).fill('');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(dialog).toBeHidden();
  expect(capturedPatchBody?.config?.gsSenderId).toBeNull();
  expect(capturedPatchBody?.config?.isaSenderId).toBe('PULSARTMS');
  expect(capturedPatchBody?.config?.url).toBeUndefined();
});
