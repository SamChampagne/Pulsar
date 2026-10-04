import {
  DeliveryPackageStatus,
  type DeliveryManifestRecord,
  type DeliveryManifestSnapshot,
} from '@pulsar/shared';
import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';
import { fulfillUnmockedDeliveryPanel } from './delivery-fixtures';

// Never let a late component refresh fall through to a real tenant after fixture teardown.
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});

const version = '2026-10-02T12:00:00.000Z';
const base = '/api/v1/transportation/loads/fixture/manifests';
const pendingKey = 'pulsar.delivery-manifests.pending.v1:fixture:operator:fixture';
const sourceHash = 'a'.repeat(64);
const snapshotHash = 'b'.repeat(64);
function snapshotFixture(): DeliveryManifestSnapshot {
  const origin = {
    name: 'Atelier Laval',
    addressLine1: '180 boulevard Industriel',
    addressLine2: 'Quai 3',
    city: 'Laval',
    province: 'QC',
    postalCode: 'H7L 4V6',
    country: 'CA',
  };
  const destination = {
    name: 'Usine Québec',
    addressLine1: '845 avenue de la Production',
    addressLine2: null,
    city: 'Québec',
    province: 'QC',
    postalCode: 'G1M 2V8',
    country: 'CA',
  };
  return {
    schemaVersion: 1,
    load: {
      id: 'fixture',
      loadNumber: 'LD-RECETTE',
      status: 'PLANNED',
      updatedAt: version,
      carrierName: 'Transport Nord',
      driverName: 'Camille Mercier',
      vehicleNumber: 'TRK-18',
      trailerNumber: 'TRL-06',
    },
    stops: [
      { sequence: 1, type: 'PICKUP', location: origin },
      {
        sequence: 2,
        type: 'WAYPOINT',
        location: {
          ...destination,
          name: 'Point de contrôle',
          addressLine1: '51 chemin de la Traverse',
          addressLine2: 'Porte nord',
          city: 'Donnacona',
          postalCode: 'G3M 1C4',
        },
      },
      { sequence: 3, type: 'DELIVERY', location: destination },
    ],
    shipments: [
      {
        id: 'shipment-1',
        shipmentNumber: 'SH-COMPOSANTS',
        status: 'PLANNED',
        trackingEnabled: true,
        origin,
        destination,
        packages: [
          {
            id: 'pkg-1',
            code: 'PKG-0001',
            label: 'Caisse assemblage A',
            status: DeliveryPackageStatus.PREPARED,
            version: 1,
            loadedAt: null,
            deliveredAt: null,
            contents: [
              { reference: 'AX-84', description: 'Axes usinés', quantity: '12', unit: 'pièce' },
              {
                reference: 'RES-2',
                description: 'Résine de montage',
                quantity: '1.375',
                unit: 'kg',
              },
            ],
          },
          {
            id: 'pkg-2',
            code: 'PKG-0002',
            label: 'Ancienne préparation',
            status: DeliveryPackageStatus.CANCELLED,
            version: 2,
            loadedAt: null,
            deliveredAt: null,
            contents: [
              { reference: 'OLD-7', description: 'Emballage annulé', quantity: '1', unit: 'pièce' },
            ],
          },
        ],
      },
    ],
  };
}
function recordFixture(revision = 1): DeliveryManifestRecord {
  return {
    id: `manifest-${revision}`,
    number: `MF-${String(revision).padStart(6, '0')}`,
    revision,
    issuedAt: `2026-10-02T12:${String(revision).padStart(2, '0')}:00.000Z`,
    reason: `Édition de contrôle ${revision}`,
    sourceHash,
    snapshotHash,
    snapshot: snapshotFixture(),
  };
}
async function setup(
  page: Page,
  options: {
    manage?: boolean;
    read?: boolean;
    records?: DeliveryManifestRecord[];
    failList?: boolean;
    ready?: boolean;
  } = {},
) {
  const { manage = true, read = true } = options;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ manage, read }) => {
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
            name: 'Composants du Nord',
            slug: 'fixture',
            enabledModules: ['transportation'],
          },
        }),
      );
    },
    { manage, read },
  );
  const state = {
    records: options.records ?? ([] as DeliveryManifestRecord[]),
    snapshot: snapshotFixture(),
    sourceHash,
    failList: options.failList ?? false,
    blockers: [] as string[],
    acceptThenFail: false,
    conflict: false,
    malformedReceipt: false,
  };
  const requests: { method: string; path: string; body: any; authorization: string | undefined }[] =
    [];
  const ready = new Set<string>();
  if (options.ready)
    for (const record of state.records)
      for (const kind of ['manifest', 'labels']) {
        ready.add(`${record.id}/${kind}`);
      }
  const receipts = new Map<string, DeliveryManifestRecord>();
  await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const method = request.method();
    if (path.startsWith(base)) {
      const body = request.postData() ? request.postDataJSON() : null;
      requests.push({ method, path, body, authorization: request.headers().authorization });
      if (path === base && method === 'GET') {
        if (state.failList)
          return route.fulfill({ status: 503, json: { message: 'Archives indisponibles.' } });
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const pageSize = Number(url.searchParams.get('pageSize') ?? 5);
        const sorted = [...state.records].sort((a, b) => b.revision - a.revision);
        return route.fulfill({
          json: {
            items: sorted
              .slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
              .map(({ snapshot, ...rest }) => rest),
            total: sorted.length,
            page: pageNumber,
            pageSize,
          },
        });
      }
      if (path === `${base}/preview`)
        return route.fulfill({
          json: {
            sourceHash: state.sourceHash,
            snapshot: state.snapshot,
            canIssue: state.blockers.length === 0,
            blockers: state.blockers,
          },
        });
      if (path === base && method === 'POST') {
        if (!manage) return route.fulfill({ status: 403, json: { message: 'Lecture seulement.' } });
        if (receipts.has(body.operationKey))
          return route.fulfill({ json: receipts.get(body.operationKey) });
        if (
          state.conflict ||
          body.sourceHash !== state.sourceHash ||
          body.expectedLoadUpdatedAt !== state.snapshot.load.updatedAt
        ) {
          return route.fulfill({
            status: 409,
            json: { message: 'Le chargement a changé depuis cet aperçu.' },
          });
        }
        const record = {
          ...recordFixture(state.records.length + 1),
          sourceHash: body.sourceHash,
          reason: body.reason,
          snapshot: structuredClone(state.snapshot),
        };
        state.records.push(record);
        receipts.set(body.operationKey, record);
        if (state.acceptThenFail) {
          state.acceptThenFail = false;
          return route.fulfill({
            status: 503,
            json: { message: 'Réponse perdue après émission.' },
          });
        }
        if (state.malformedReceipt)
          return route.fulfill({ json: { ...record, sourceHash: 'c'.repeat(64) } });
        return route.fulfill({ json: record });
      }
      const fileMatch = path.match(/\/manifests\/([^/]+)\/files\/(manifest|labels)$/);
      if (fileMatch) {
        const key = `${fileMatch[1]}/${fileMatch[2]}`;
        if (method === 'POST') {
          if (!manage)
            return route.fulfill({ status: 403, json: { message: 'Lecture seulement.' } });
          ready.add(key);
          return route.fulfill({ json: { ready: true } });
        }
        if (!ready.has(key))
          return route.fulfill({ status: 404, json: { message: 'Fichier non préparé.' } });
        return route.fulfill({
          contentType: 'application/pdf',
          body: '%PDF-1.4\n%fixture immutable manifest\n%%EOF',
        });
      }
      const record = state.records.find((item) => path === `${base}/${item.id}`);
      if (record && method === 'GET') return route.fulfill({ json: record });
      throw new Error(`Unexpected manifest request ${method} ${path}`);
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
          shipments: [
            {
              id: 'shipment-1',
              shipmentNumber: 'SH-COMPOSANTS',
              status: 'PLANNED',
              transportOrderId: 'order',
              originLocationId: 'origin',
              destinationLocationId: 'destination',
              proofOfDelivery: null,
            },
          ],
        },
      });
    if (path === '/api/v1/transportation/delivery-packages')
      return route.fulfill({
        json: {
          load: state.snapshot.load,
          shipments: state.snapshot.shipments.map((shipment) => ({
            ...shipment,
            updatedAt: version,
            packageTrackingEnabledAt: version,
            originName: shipment.origin.name,
            destinationName: shipment.destination.name,
            packages: shipment.packages.map((pkg) => ({ ...pkg, updatedAt: version })),
          })),
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
  if (read)
    await expect(
      panel(page).getByRole('heading', { name: 'Manifestes et étiquettes', exact: true }),
    ).toBeVisible();
  return { state, requests, writes: () => requests.filter((request) => request.method !== 'GET') };
}
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Manifestes et étiquettes', exact: true });
const drawer = (page: Page) =>
  page.getByRole('dialog', { name: 'Aperçu du manifeste', exact: true });
async function preview(page: Page) {
  await panel(page)
    .getByRole('button', { name: /Préparer un manifeste|Nouvelle édition/, exact: true })
    .click();
  await expect(drawer(page).getByRole('heading', { name: 'LD-RECETTE' })).toBeVisible();
}
async function emit(page: Page, reason = 'Préparation composants tournée matin') {
  await drawer(page).getByRole('textbox').fill(reason);
  await drawer(page).getByRole('button', { name: 'Émettre cette édition', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Émettre le manifeste', exact: true })
    .getByRole('button', { name: 'Émettre', exact: true })
    .click();
}
async function closeDrawer(page: Page) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Fermer', exact: true })
    .last()
    .click();
}

test('preview exposes every stop address, exact contents and requires reason plus confirmation', async ({
  page,
}, info) => {
  const { writes } = await setup(page);
  await preview(page);
  await expect(drawer(page)).toContainText('51 chemin de la Traverse');
  await expect(drawer(page)).toContainText('Porte nord');
  await expect(drawer(page)).toContainText('Donnacona · QC · G3M 1C4');
  await expect(drawer(page)).toContainText('1.375 kg');
  await expect(drawer(page)).toContainText('2 colis déclarés · 1 étiquettes');
  await expect(drawer(page).getByRole('region', { name: 'Colis PKG-0002' })).toContainText(
    'Sans étiquette',
  );
  await expect(drawer(page).getByRole('button', { name: 'Émettre cette édition' })).toBeDisabled();
  await drawer(page).getByRole('textbox').fill('  Chargement équipe matin  ');
  await drawer(page).getByRole('button', { name: 'Émettre cette édition' }).click();
  expect(writes()).toHaveLength(0);
  await page
    .getByRole('dialog', { name: 'Émettre le manifeste' })
    .getByRole('button', { name: 'Émettre', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'MF-000001 · édition 1', exact: true }),
  ).toBeVisible();
  expect(writes()).toHaveLength(1);
  expect(writes()[0].body).toMatchObject({
    sourceHash,
    expectedLoadUpdatedAt: version,
    reason: 'Chargement équipe matin',
  });
  expect(writes()[0].body.operationKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  await page.screenshot({
    path: info.outputPath('delivery-manifest-desktop.png'),
    animations: 'disabled',
  });
});

test('archive navigation preserves the old snapshot and exposes its hashes', async ({ page }) => {
  const { state, writes } = await setup(page, {
    records: Array.from({ length: 6 }, (_, i) => recordFixture(i + 1)),
  });
  await expect(panel(page).getByRole('button', { name: 'Nouvelle édition' })).toBeEnabled();
  await panel(page).getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(panel(page)).toContainText('Page 2 sur 2');
  state.snapshot.load.vehicleNumber = 'TRK-NEW';
  state.snapshot.shipments[0].destination.addressLine1 = 'Adresse actuelle remplacée';
  await panel(page).getByRole('button', { name: 'Consulter', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'MF-000001 · édition 1', exact: true });
  await expect(detail).toContainText('TRK-18');
  await expect(detail).toContainText('845 avenue de la Production');
  await expect(detail).not.toContainText('Adresse actuelle remplacée');
  await detail.getByText('Empreintes de l’édition', { exact: true }).click();
  await expect(detail).toContainText(`Capture : ${snapshotHash}`);
  expect(writes()).toHaveLength(0);
});

test('uncertain committed issue survives reload and replays its exact key and captured body', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  state.acceptThenFail = true;
  await preview(page);
  await emit(page);
  await expect(drawer(page).getByRole('alert')).toContainText('Réponse incertaine');
  expect(state.records).toHaveLength(1);
  await closeDrawer(page);
  await expect(
    panel(page).getByRole('button', { name: 'Préparer un manifeste', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await panel(page).getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'MF-000001 · édition 1', exact: true }),
  ).toBeVisible();
  expect(writes()).toHaveLength(2);
  expect(writes()[1]).toEqual(writes()[0]);
  expect(state.records).toHaveLength(1);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).toBeNull();
});

test('409 retains intent until explicit archive inspection and a fresh preview', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  state.conflict = true;
  await preview(page);
  await emit(page, 'Premier aperçu périmé');
  await expect(drawer(page).getByRole('alert')).toContainText(
    'Une émission concurrente est possible',
  );
  await closeDrawer(page);
  await expect(
    panel(page).getByRole('button', { name: 'Préparer un manifeste', exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).not.toBeNull();
  expect(writes()).toHaveLength(1);
  await panel(page).getByRole('button', { name: 'Vérifier les archives', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Terminer la vérification', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Archives vérifiées', exact: true })
    .getByRole('button', { name: 'Terminer la vérification', exact: true })
    .click();
  state.conflict = false;
  state.sourceHash = 'c'.repeat(64);
  state.snapshot.load.updatedAt = '2026-10-02T12:15:00.000Z';
  await preview(page);
  await emit(page, 'Nouvelle inspection complète');
  await expect(
    page.getByRole('dialog', { name: 'MF-000001 · édition 1', exact: true }),
  ).toBeVisible();
  expect(writes()).toHaveLength(2);
  expect(writes()[1].body.operationKey).not.toBe(writes()[0].body.operationKey);
  expect(writes()[1].body.sourceHash).toBe('c'.repeat(64));
  expect(writes()[1].body.expectedLoadUpdatedAt).toBe('2026-10-02T12:15:00.000Z');
});

test('archive PDF actions prepare one frozen edition and download with authentication', async ({
  page,
}) => {
  const { requests, writes } = await setup(page, { records: [recordFixture()] });
  const download = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: 'PDF manifeste', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('MF-000001-manifeste.pdf');
  const labelDownload = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: 'PDF étiquettes', exact: true }).click();
  expect((await labelDownload).suggestedFilename()).toBe('MF-000001-etiquettes.pdf');
  expect(writes().map((request) => request.path)).toEqual([
    `${base}/manifest-1/files/manifest`,
    `${base}/manifest-1/files/labels`,
  ]);
  expect(
    requests
      .filter((request) => request.path.includes('/files/'))
      .every((request) => request.authorization === 'Bearer fixture-token'),
  ).toBe(true);
  expect(writes().some((request) => request.path === base)).toBe(false);
});

test('read-only archives download prepared files without any POST or issuance control', async ({
  page,
}) => {
  const { writes } = await setup(page, { manage: false, records: [recordFixture()], ready: true });
  await expect(
    panel(page).getByRole('button', { name: /Préparer un manifeste|Nouvelle édition/ }),
  ).toHaveCount(0);
  const download = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: 'PDF manifeste', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('MF-000001-manifeste.pdf');
  await panel(page).getByRole('button', { name: 'Consulter', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', {
      name: /Préparer le PDF|Préparer les étiquettes|Émettre cette édition/,
    }),
  ).toHaveCount(0);
  expect(writes()).toHaveLength(0);
});

test('read-only missing PDF guides to a planner and never prepares it implicitly', async ({
  page,
}) => {
  const { writes } = await setup(page, { manage: false, records: [recordFixture()] });
  await panel(page).getByRole('button', { name: 'PDF étiquettes', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText(
    'Un utilisateur avec le droit de planification',
  );
  expect(writes()).toHaveLength(0);
});

test('no planning read means no manifest request or panel', async ({ page }) => {
  const { requests } = await setup(page, { read: false, manage: false });
  await expect(panel(page)).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test('archive failure blocks issuance until successful retry, and blockers remain explicit', async ({
  page,
}) => {
  const { state, writes } = await setup(page, { failList: true });
  await expect(panel(page)).toContainText('Archives indisponibles.');
  await expect(
    panel(page).getByRole('button', { name: 'Préparer un manifeste', exact: true }),
  ).toBeDisabled();
  state.failList = false;
  await panel(page)
    .getByRole('button', { name: /Réessayer|Retry|Réessayer le chargement/ })
    .click();
  state.blockers = ['Cette source a déjà été capturée dans la dernière édition.'];
  await preview(page);
  await drawer(page).getByRole('textbox').fill('Raison ne contourne pas le blocage');
  await expect(drawer(page)).toContainText(state.blockers[0]);
  await expect(drawer(page).getByRole('button', { name: 'Émettre cette édition' })).toBeDisabled();
  expect(writes()).toHaveLength(0);
});

test('malformed receipt is treated as uncertain and keeps the original request', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  state.malformedReceipt = true;
  await preview(page);
  await emit(page);
  await expect(drawer(page).getByRole('alert')).toContainText('Réponse incertaine');
  const saved = await page.evaluate((key) => sessionStorage.getItem(key), pendingKey);
  expect(JSON.parse(saved!).body).toEqual(writes()[0].body);
  expect(state.records).toHaveLength(1);
});

test('mobile preview is scrollable without horizontal overflow and keeps actions reachable', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await preview(page);
  await drawer(page).getByRole('textbox').fill('Préparation mobile');
  await expect(
    drawer(page).getByRole('button', { name: 'Émettre cette édition' }),
  ).toBeInViewport();
  await expect(
    drawer(page).getByRole('button', { name: 'Fermer', exact: true }).last(),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await drawer(page).boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: info.outputPath('delivery-manifest-mobile.png'),
    animations: 'disabled',
  });
});
