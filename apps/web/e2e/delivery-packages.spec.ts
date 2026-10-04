import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';
import { fulfillUnmockedDeliveryPanel } from './delivery-fixtures';

// Destroy the SPA while mocks are still installed, so late reloads cannot reach a real API.
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});

const version = '2026-10-02T12:00:00.000Z';
const endpoint = '/api/v1/transportation/delivery-packages';
function packageFixture(id = 'pkg-1', status = 'PREPARED') {
  return {
    id,
    code: id === 'pkg-1' ? 'PKG-0001' : 'PKG-0002',
    label: 'Caisse de composants',
    status,
    contents: [
      { reference: 'AX-84', description: 'Axes usinés', quantity: '12', unit: 'pièce' },
      { reference: 'RES-2', description: 'Résine de montage', quantity: '1.375', unit: 'kg' },
    ],
    version: 1,
    loadedAt: status === 'LOADED' ? version : null,
    deliveredAt: null as string | null,
    updatedAt: version,
  };
}
async function setup(
  page: Page,
  options: {
    manage?: boolean;
    execute?: boolean;
    read?: boolean;
    loadStatus?: string;
    packages?: ReturnType<typeof packageFixture>[];
    failRead?: boolean;
  } = {},
) {
  const { manage = true, execute = true, read = true, loadStatus = 'PLANNED' } = options;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ manage, execute, read }) =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'fixture',
          refreshToken: 'fixture',
          user: {
            id: 'operator',
            firstName: 'Camille',
            lastName: 'Recette',
            email: 'fixture@example.invalid',
            permissions: [
              'transportation.execution.read',
              ...(read ? ['transportation.planning.read'] : []),
              ...(manage ? ['transportation.planning.manage'] : []),
              ...(execute ? ['transportation.execution.manage'] : []),
            ],
          },
          tenant: {
            id: 'fixture',
            name: 'Composants du Nord',
            slug: 'fixture',
            enabledModules: ['transportation'],
          },
        }),
      ),
    { manage, execute, read },
  );
  const state = {
    loadStatus,
    loadUpdatedAt: version,
    packages: options.packages ?? [packageFixture()],
    acceptThenFail: false,
    conflict: false,
    failRead: options.failRead ?? false,
  };
  const writes: { method: string; path: string; body: any }[] = [];
  const receipts = new Map<string, object>();
  let packageReads = 0;
  const manifest = () => ({
    load: {
      id: 'fixture',
      loadNumber: 'LD-RECETTE',
      status: state.loadStatus,
      updatedAt: state.loadUpdatedAt,
    },
    shipments: [
      {
        id: 'shipment-1',
        shipmentNumber: 'SH-COMPOSANTS',
        status: state.loadStatus === 'IN_TRANSIT' ? 'IN_TRANSIT' : 'PLANNED',
        updatedAt: version,
        packageTrackingEnabledAt: state.packages.length ? version : null,
        originName: 'Atelier Laval',
        destinationName: 'Usine Québec',
        packages: state.packages,
      },
    ],
  });
  await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.startsWith(endpoint)) {
      if (request.method() === 'GET') {
        packageReads++;
        return state.failRead
          ? route.fulfill({ status: 503, json: { message: 'Lecture des colis indisponible.' } })
          : route.fulfill({ json: manifest() });
      }
      const body = request.postDataJSON();
      writes.push({ method: request.method(), path, body });
      if (receipts.has(body.operationKey))
        return route.fulfill({ json: receipts.get(body.operationKey) });
      if (
        path.endsWith('/transition') &&
        (body.expectedLoadId !== 'fixture' || body.expectedLoadUpdatedAt !== state.loadUpdatedAt)
      )
        return route.fulfill({
          status: 409,
          json: { message: 'Le chargement a changé. Relisez son affectation.' },
        });
      if (state.conflict)
        return route.fulfill({
          status: 409,
          json: { message: 'Le colis a changé. Version attendue obsolète.' },
        });
      let pkg = state.packages.find(
        (p) => path === `${endpoint}/${p.id}` || path === `${endpoint}/${p.id}/transition`,
      );
      if (path === `${endpoint}/shipment/shipment-1`) {
        pkg = {
          ...packageFixture(state.packages.length ? 'pkg-2' : 'pkg-1'),
          label: body.label,
          contents: body.contents,
        };
        state.packages.push(pkg);
      } else if (pkg && path.endsWith('/transition')) {
        pkg.status = body.target;
        pkg.version++;
        if (body.target === 'LOADED') pkg.loadedAt = version;
        if (body.target === 'DELIVERED') pkg.deliveredAt = version;
      } else if (pkg) {
        pkg.label = body.label;
        pkg.contents = body.contents;
        pkg.version++;
      }
      if (!pkg) throw new Error(`Unexpected package request ${path}`);
      const receipt = {
        operationKey: body.operationKey,
        packageId: pkg.id,
        version: pkg.version,
        status: pkg.status,
        code: pkg.code,
      };
      receipts.set(body.operationKey, receipt);
      state.loadUpdatedAt = new Date(Date.parse(state.loadUpdatedAt) + 1000).toISOString();
      if (state.acceptThenFail) {
        state.acceptThenFail = false;
        return route.fulfill({ status: 503, json: { message: 'Réponse perdue après commit.' } });
      }
      return route.fulfill({ json: receipt });
    }
    if (path === '/api/v1/transportation/loads/fixture')
      return route.fulfill({
        json: {
          id: 'fixture',
          loadNumber: 'LD-RECETTE',
          updatedAt: version,
          status: state.loadStatus,
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
          shipments: [
            {
              id: 'shipment-1',
              shipmentNumber: 'SH-COMPOSANTS',
              status: state.loadStatus === 'IN_TRANSIT' ? 'IN_TRANSIT' : 'PLANNED',
              transportOrderId: 'order',
              originLocationId: 'origin',
              destinationLocationId: 'destination',
              proofOfDelivery: null,
            },
          ],
        },
      });
    if (path === '/api/v1/transportation/accessorials')
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } });
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
  if (read) await expect(page.getByRole('heading', { name: 'Colis et contenu' })).toBeVisible();
  return { state, writes, getPackageReads: () => packageReads };
}
async function confirm(page: Page) {
  await page
    .getByRole('dialog', { name: 'Confirmer le colis', exact: true })
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
}
const panel = (page: Page) => page.getByRole('region', { name: 'Colis et contenu', exact: true });

test('creates a confirmed multi-line package with exact quantities and shipment version', async ({
  page,
}) => {
  const { writes } = await setup(page, { packages: [] });
  await expect(
    panel(page).getByText('Suivi par colis non activé.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter un colis à SH-COMPOSANTS' }).click();
  await page
    .getByLabel('Libellé du colis (facultatif)', { exact: true })
    .fill('Caisse assemblage 4');
  await page.getByLabel('Référence 1', { exact: true }).fill('AX-84');
  await page.getByLabel('Description 1', { exact: true }).fill('Axes usinés');
  await page.getByLabel('Quantité 1', { exact: true }).fill('12');
  await page.getByLabel('Unité 1', { exact: true }).fill('pièce');
  await page.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click();
  await page.getByLabel('Référence 2', { exact: true }).fill('RES-2');
  await page.getByLabel('Description 2', { exact: true }).fill('Résine de montage');
  await page.getByLabel('Quantité 2', { exact: true }).fill('1.375');
  await page.getByLabel('Unité 2', { exact: true }).fill('kg');
  await page.getByRole('button', { name: 'Créer le colis', exact: true }).click();
  expect(writes).toHaveLength(0);
  await confirm(page);
  await expect(page.getByRole('article', { name: 'Colis PKG-0001', exact: true })).toContainText(
    '1.375 kg',
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].body.expectedUpdatedAt).toBe(version);
  expect(writes[0].body.contents[1].quantity).toBe('1.375');
  expect(writes[0].body.operationKey).toMatch(/^[0-9a-f-]{36}$/);
});

test('scanner only selects an exact code and loading requires confirmation', async ({ page }) => {
  const { writes } = await setup(page);
  await page.getByLabel('Scanner ou saisir le code exact', { exact: true }).fill('PKG-000');
  await page.getByRole('button', { name: 'Repérer', exact: true }).click();
  await expect(panel(page).getByText('Code exact introuvable', { exact: false })).toBeVisible();
  await page.getByLabel('Scanner ou saisir le code exact', { exact: true }).fill('PKG-0001');
  await page.getByRole('button', { name: 'Repérer', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Colis PKG-0001', exact: true })).toContainText(
    'Sélectionné',
  );
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Charger PKG-0001', exact: true }).click();
  expect(writes).toHaveLength(0);
  await confirm(page);
  await expect(
    page.getByRole('button', { name: 'Retirer du camion PKG-0001', exact: true }),
  ).toBeEnabled();
  expect(writes[0].body).toMatchObject({
    expectedVersion: 1,
    target: 'LOADED',
    expectedLoadId: 'fixture',
    expectedLoadUpdatedAt: version,
  });
});

test('loading captures the observed load version before confirmation', async ({ page }) => {
  const { state, writes } = await setup(page);
  await page.getByRole('button', { name: 'Charger PKG-0001', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmer le colis', exact: true })).toBeVisible();
  state.loadUpdatedAt = '2026-10-02T12:01:00.000Z';
  await confirm(page);
  await expect(panel(page).getByRole('alert')).toContainText('Le chargement a changé');
  expect(writes[0].body.expectedLoadUpdatedAt).toBe(version);
  expect(writes[0].body.expectedLoadId).toBe('fixture');
  expect(state.packages[0].status).toBe('PREPARED');
});

test('uncertain committed transition survives reload and replays the same operation and body', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  state.acceptThenFail = true;
  await page.getByRole('button', { name: 'Charger PKG-0001', exact: true }).click();
  await confirm(page);
  await expect(panel(page).getByRole('alert')).toContainText('Réponse incertaine');
  await expect(
    page.getByRole('button', { name: 'Ajouter un colis à SH-COMPOSANTS' }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reprendre la même demande', exact: true }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(state.packages[0].version).toBe(2);
});

test('one delivery captures recipient and leaves the other package loaded', async ({ page }) => {
  const { state, writes } = await setup(page, {
    loadStatus: 'IN_TRANSIT',
    packages: [packageFixture('pkg-1', 'LOADED'), packageFixture('pkg-2', 'LOADED')],
  });
  await expect(
    panel(page).getByRole('button', { name: /Retirer du camion|Ajouter un colis|Annuler PKG/ }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Livrer PKG-0001', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer la remise', exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByLabel('Nom du destinataire', { exact: true }).fill('Nadia Tremblay');
  await page.getByRole('button', { name: 'Confirmer la remise', exact: true }).click();
  await confirm(page);
  await expect(panel(page)).toContainText('Livraison partielle');
  expect(writes[0].body.recipientName).toBe('Nadia Tremblay');
  expect(writes[0].body).toMatchObject({
    expectedLoadId: 'fixture',
    expectedLoadUpdatedAt: version,
  });
  expect(state.packages.map((p) => p.status)).toEqual(['DELIVERED', 'LOADED']);
});

test('read-only permissions do not expose mutation controls', async ({ page }) => {
  const { writes } = await setup(page, { manage: false, execute: false });
  await expect(panel(page).getByText('12 pièce', { exact: true })).toBeVisible();
  await expect(
    panel(page).getByRole('button', {
      name: /Ajouter un colis|Modifier PKG|Charger PKG|Livrer PKG|Annuler PKG/,
    }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('execution permission alone allows loading but not preparation or cancellation', async ({
  page,
}) => {
  await setup(page, { manage: false });
  await expect(
    panel(page).getByRole('button', { name: /Ajouter un colis|Modifier PKG|Annuler PKG/ }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Charger PKG-0001', exact: true })).toBeEnabled();
});

test('without planning read no package data is requested or displayed', async ({ page }) => {
  const { getPackageReads } = await setup(page, { read: false, manage: false });
  await expect(page.getByRole('heading', { name: 'Colis et contenu', exact: true })).toHaveCount(0);
  expect(getPackageReads()).toBe(0);
});

test('stale version and read failure remain explicit with no silent retry', async ({ page }) => {
  const { state, writes } = await setup(page);
  state.conflict = true;
  await page.getByRole('button', { name: 'Charger PKG-0001', exact: true }).click();
  await confirm(page);
  await expect(panel(page).getByRole('alert')).toContainText('Version attendue obsolète');
  expect(writes).toHaveLength(1);
  state.failRead = true;
  await page.getByRole('button', { name: 'Actualiser les colis', exact: true }).click();
  await expect(
    panel(page).getByRole('alert').filter({ hasText: 'Lecture des colis indisponible' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Charger PKG-0001', exact: true })).toBeDisabled();
});

test('mobile contents and drawer remain within viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole('button', { name: 'Modifier PKG-0001', exact: true }).click();
  await expect(page.getByLabel('Quantité 2', { exact: true })).toHaveValue('1.375');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Modifier PKG-0001', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Enregistrer le colis', exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: info.outputPath('delivery-packages-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('desktop manifest shows contents and per-shipment progress', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await setup(page, { packages: [packageFixture(), packageFixture('pkg-2', 'LOADED')] });
  await expect(panel(page)).toContainText('0 / 2 colis livrés · 1 chargés');
  await panel(page).screenshot({
    path: info.outputPath('delivery-packages-desktop.png'),
    animations: 'disabled',
  });
});
