import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';
import { fulfillUnmockedDeliveryPanel } from './delivery-fixtures';
import type { DriverDocumentRecord, DriverDocumentSnapshot } from '@pulsar/shared';

const version = '2026-10-03T12:00:00.000Z',
  base = '/api/v1/transportation/loads/fixture/driver-documents';
const sourceHash = 'a'.repeat(64),
  snapshotHash = 'b'.repeat(64);
const pendingKey = 'pulsar.driver-document.pending.v1:fixture:operator:fixture';
const address = {
  name: 'Atelier Laval',
  addressLine1: '180 boulevard Industriel',
  addressLine2: null,
  city: 'Laval',
  province: 'QC',
  postalCode: 'H7L 4V6',
  country: 'CA',
};
const snapshot: DriverDocumentSnapshot = {
  schemaVersion: 1,
  load: {
    loadNumber: 'LD-RECETTE',
    updatedAt: version,
    driverName: 'Camille Mercier',
    carrierName: null,
    vehicleNumber: 'V-18',
    trailerNumber: null,
  },
  stops: [{ sequence: 1, type: 'PICKUP', location: address }],
  shipments: [
    {
      shipmentNumber: 'SH-1',
      trackingEnabled: true,
      origin: address,
      destination: { ...address, name: 'Usine Québec', city: 'Québec' },
      packageCodes: ['PKG-0001'],
    },
  ],
};
const record = (): DriverDocumentRecord => ({
  id: 'doc-1',
  number: 'DL-000001',
  revision: 1,
  issuedAt: version,
  reason: 'Préparation tournée',
  sourceHash,
  snapshotHash,
  snapshot,
  ready: false,
});
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});
async function setup(
  page: Page,
  options: { manage?: boolean; read?: boolean; existing?: boolean } = {},
) {
  const manage = options.manage ?? true,
    read = options.read ?? true;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ read, manage }) => {
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'fixture-token',
          refreshToken: 'fixture-refresh',
          user: {
            id: 'operator',
            firstName: 'Camille',
            lastName: 'Recette',
            email: 'fixture@example.invalid',
            permissions: [
              'transportation.execution.read',
              ...(read ? ['transportation.planning.read'] : []),
              ...(manage ? ['transportation.planning.manage'] : []),
            ],
          },
          tenant: {
            id: 'fixture',
            name: 'Atelier',
            slug: 'fixture',
            enabledModules: ['transportation'],
          },
        }),
      );
    },
    { read, manage },
  );
  const state = {
    items: options.existing ? [record()] : ([] as DriverDocumentRecord[]),
    acceptThenFail: false,
    reject: false,
  };
  const requests: { method: string; path: string; body: any }[] = [],
    receipts = new Map<string, DriverDocumentRecord>();
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      method = req.method();
    if (path.startsWith(base)) {
      const body = req.postData() ? req.postDataJSON() : null;
      requests.push({ method, path, body });
      if (path === base && method === 'GET')
        return route.fulfill({
          json: {
            items: state.items.map(({ snapshot: _snapshot, ...s }) => s),
            total: state.items.length,
            page: 1,
            pageSize: 5,
          },
        });
      if (path.endsWith('/preview'))
        return route.fulfill({ json: { snapshot, sourceHash, canIssue: true, blockers: [] } });
      if (path === base && method === 'POST') {
        if (receipts.has(body.operationKey))
          return route.fulfill({ json: receipts.get(body.operationKey) });
        if (state.reject)
          return route.fulfill({
            status: 409,
            json: { message: 'Adresse changée, relisez la tournée.' },
          });
        const result = { ...record(), reason: body.reason };
        state.items.push(result);
        receipts.set(body.operationKey, result);
        if (state.acceptThenFail) {
          state.acceptThenFail = false;
          return route.fulfill({ status: 503, json: { message: 'Réponse perdue.' } });
        }
        return route.fulfill({ json: result });
      }
      if (path.endsWith('/file')) {
        if (method === 'POST') {
          state.items[0].ready = true;
          return route.fulfill({ json: { ready: true } });
        }
        return route.fulfill({
          contentType: 'application/pdf',
          body: '%PDF-1.4\n% local fixture\n%%EOF',
        });
      }
      return route.fulfill({ json: state.items[0] });
    }
    if (path === '/api/v1/transportation/loads/fixture')
      return route.fulfill({
        json: {
          id: 'fixture',
          loadNumber: 'LD-RECETTE',
          updatedAt: version,
          status: 'PLANNED',
          carrier: null,
          driver: null,
          vehicle: null,
          trailer: null,
          rate: null,
          mode: 'FTL',
          notes: null,
          estimatedCost: null,
          costDetail: null,
          costCurrency: null,
          accessorials: [],
          route: null,
          shipments: [],
        },
      });
    if (path.endsWith('/delivery-packages'))
      return route.fulfill({
        json: { load: { id: 'fixture', ...snapshot.load, status: 'PLANNED' }, shipments: [] },
      });
    if (path.endsWith('/manifests') || path.endsWith('/accessorials'))
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 5 } });
    if (await fulfillUnmockedDeliveryPanel(route)) return;
    return route.fulfill({
      json: path.endsWith('/preferences')
        ? EXPERIENCED_PREFERENCES
        : path.endsWith('/unseen-count')
          ? { count: 0 }
          : [],
    });
  });
  await page.goto('/loads/fixture');
  await expect(page.getByRole('heading', { name: 'Tournée et carburant' })).toBeVisible();
  return { state, requests, writes: () => requests.filter((r) => r.method !== 'GET') };
}
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Documents chauffeur', exact: true });
const drawer = (page: Page) =>
  page.getByRole('dialog', { name: 'Aperçu chauffeur avant publication', exact: true });
async function open(page: Page) {
  await panel(page).getByRole('button', { name: 'Préparer une publication' }).click();
  await expect(drawer(page)).toContainText('Camille Mercier');
}
async function publish(page: Page) {
  await drawer(page).getByRole('textbox').fill('Revue des adresses avant départ');
  await drawer(page).getByRole('button', { name: 'Publier au chauffeur', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Publier le document chauffeur', exact: true })
    .getByRole('button', { name: 'Publier au chauffeur', exact: true })
    .click();
}

test('preview requires reason and explicit public confirmation, then offers PDF preparation', async ({
  page,
}) => {
  const { writes } = await setup(page);
  await open(page);
  await expect(drawer(page)).toContainText('180 boulevard Industriel');
  await expect(drawer(page)).toContainText('PKG-0001');
  await expect(
    drawer(page).getByRole('button', { name: 'Publier au chauffeur', exact: true }),
  ).toBeDisabled();
  expect(writes()).toHaveLength(0);
  await publish(page);
  await expect(page.getByRole('dialog', { name: 'DL-000001 · édition 1' })).toBeVisible();
  expect(writes()).toHaveLength(1);
  expect(writes()[0].body).toMatchObject({
    sourceHash,
    expectedLoadUpdatedAt: version,
    confirmDriverPublication: true,
  });
  expect(await page.evaluate((k) => sessionStorage.getItem(k), pendingKey)).toBeNull();
  const download = page.waitForEvent('download');
  await page.getByRole('dialog').getByRole('button', { name: 'Préparer le PDF' }).click();
  expect((await download).suggestedFilename()).toBe('DL-000001-r1.pdf');
});
test('uncertain accepted publication reuses exactly its saved request after reload', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  state.acceptThenFail = true;
  await open(page);
  await publish(page);
  await expect(drawer(page)).toContainText('demande exacte est conservée');
  const firstBody = structuredClone(writes()[0].body);
  await page.reload();
  await expect(
    panel(page).getByRole('button', { name: 'Reprendre la même demande' }),
  ).toBeVisible();
  expect(writes()).toHaveLength(1);
  await panel(page).getByRole('button', { name: 'Reprendre la même demande' }).click();
  await expect(page.getByRole('dialog', { name: 'DL-000001 · édition 1' })).toBeVisible();
  expect(writes()[1].body).toEqual(firstBody);
  expect(state.items).toHaveLength(1);
});
test('conflict preserves intent and forbids silently issuing a different document', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  state.reject = true;
  await open(page);
  await publish(page);
  await expect(drawer(page)).toContainText('Adresse changée');
  expect(writes()).toHaveLength(1);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), pendingKey)).not.toBeNull();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Fermer', exact: true })
    .last()
    .click();
  await expect(
    panel(page).getByRole('button', { name: 'Préparer une publication' }),
  ).toBeDisabled();
});
test('reader sees archives without publish or prepare privileges', async ({ page }) => {
  const { writes } = await setup(page, { manage: false, existing: true });
  await expect(panel(page)).toContainText('DL-000001');
  await expect(panel(page).getByRole('button', { name: 'Nouvelle publication' })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Préparer le PDF' })).toBeDisabled();
  expect(writes()).toEqual([]);
});
test('no read permission means no driver document query or panel', async ({ page }) => {
  const { requests } = await setup(page, { read: false });
  await expect(panel(page)).toHaveCount(0);
  expect(requests).toEqual([]);
});
