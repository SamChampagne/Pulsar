import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';
import { fulfillUnmockedDeliveryPanel } from './delivery-fixtures';

const stamp = '2026-10-03T12:00:00.000Z';
const base = '/api/v1/transportation/delivery-exceptions';
const key = 'pulsar.delivery-exception.v1:fixture:operator:fixture';
const panel = (page: Page) => page.getByRole('region', { name: 'Incidents et retours' });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Traiter PKG-0001' });
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});

function fixture() {
  return {
    load: { status: 'IN_TRANSIT', updatedAt: stamp },
    truncated: false,
    cases: [
      {
        id: 'case-1',
        kind: 'ABSENT',
        status: 'OPEN',
        note: 'Destinataire absent au premier passage.',
        version: 1,
        retryAt: null as string | null,
        receivedAt: null as string | null,
        receivedBy: null as string | null,
        returnLocation: null as { name: string } | null,
        package: { id: 'p', code: 'PKG-0001', status: 'LOADED', version: 3 },
        nextAction: 'Choisir la prochaine action avec l’exploitation.',
        events: [
          {
            createdAt: stamp,
            snapshot: { after: { status: 'OPEN', note: 'Signalé par le chauffeur.' } },
          },
        ],
      },
    ],
  };
}

async function setup(page: Page, options: { manage?: boolean; locations?: boolean } = {}) {
  const manage = options.manage ?? true,
    locations = options.locations ?? true;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ manage, locations }) => {
      if (!/^https?:$/.test(location.protocol)) return;
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
              'transportation.planning.read',
              ...(manage ? ['transportation.execution.manage'] : []),
              ...(locations ? ['transportation.master-data.read'] : []),
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
    { manage, locations },
  );
  const state = { view: fixture(), failAfterAccept: false, failRead: false, malformed: false };
  const writes: { path: string; body: any }[] = [],
    searches: string[] = [];
  const receipts = new Map<string, unknown>();
  await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (path.startsWith(base)) {
      if (request.method() === 'GET')
        return route.fulfill(
          state.failRead
            ? { status: 503, json: { message: 'Lecture des incidents indisponible.' } }
            : { json: state.view },
        );
      const body = request.postDataJSON();
      writes.push({ path, body });
      if (receipts.has(body.operationKey))
        return route.fulfill({ json: receipts.get(body.operationKey) });
      const row = state.view.cases[0];
      row.status = body.target;
      row.version++;
      row.note = body.note;
      row.retryAt = body.retryAt ?? null;
      row.package.version++;
      if (body.target === 'RETURN_AUTHORIZED') row.returnLocation = { name: 'Dépôt Laval' };
      if (body.target === 'RETURN_RECEIVED') {
        row.receivedAt = stamp;
        row.receivedBy = body.receivedBy;
        row.package.status = 'RETURNED';
      }
      row.events.push({
        createdAt: stamp,
        snapshot: { after: { status: row.status, note: body.note } },
      });
      const receipt = {
        id: row.id,
        operationKey: body.operationKey,
        status: row.status,
        version: row.version,
      };
      receipts.set(body.operationKey, receipt);
      if (state.failAfterAccept) {
        state.failAfterAccept = false;
        return route.abort('failed');
      }
      return route.fulfill({ json: state.malformed ? { ok: true } : receipt });
    }
    if (path === '/api/v1/transportation/locations') {
      expect([...url.searchParams.keys()].sort()).toEqual(['pageSize', 'search']);
      expect(url.searchParams.get('pageSize')).toBe('50');
      searches.push(url.searchParams.get('search') ?? '');
      return route.fulfill({
        json: {
          items: [
            { id: 'depot', name: 'Dépôt Laval', city: 'Laval', isActive: true },
            { id: 'closed', name: 'Ancien dépôt fermé', city: 'Laval', isActive: false },
          ],
          total: 2,
          page: 1,
          pageSize: 50,
        },
      });
    }
    if (path === '/api/v1/transportation/loads/fixture')
      return route.fulfill({
        json: {
          id: 'fixture',
          loadNumber: 'LD-RECETTE',
          updatedAt: stamp,
          status: state.view.load.status,
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
              id: 's',
              shipmentNumber: 'SH-AXES',
              status: 'IN_TRANSIT',
              transportOrderId: 'o',
              originLocationId: 'site',
              destinationLocationId: 'd',
              proofOfDelivery: null,
            },
          ],
        },
      });
    if (path === '/api/v1/transportation/delivery-packages')
      return route.fulfill({
        json: {
          load: { id: 'fixture', loadNumber: 'LD-RECETTE', ...state.view.load },
          shipments: [
            {
              id: 's',
              shipmentNumber: 'SH-AXES',
              status: 'IN_TRANSIT',
              updatedAt: stamp,
              packageTrackingEnabledAt: stamp,
              originName: 'Atelier Laval',
              destinationName: 'Usine Québec',
              packages: [
                {
                  ...state.view.cases[0].package,
                  label: 'Axes usinés',
                  loadedAt: stamp,
                  deliveredAt: null,
                  updatedAt: stamp,
                  contents: [
                    {
                      reference: 'AX-84',
                      description: 'Axes usinés',
                      quantity: '2.125',
                      unit: 'pièce',
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    if (path.endsWith('/accessorials'))
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
  await expect(panel(page)).toContainText('Destinataire absent au premier passage.');
  return { state, writes, searches };
}

async function planRetry(page: Page) {
  await panel(page).getByRole('button', { name: 'Traiter', exact: true }).click();
  await drawer(page).getByLabel('Décision').selectOption('RETRY_PLANNED');
  await drawer(page).getByLabel('Prochaine tentative').fill('2030-10-04T10:30');
  await drawer(page)
    .getByLabel('Constat / justification')
    .fill('Rendez-vous confirmé avec le destinataire.');
  await drawer(page).getByRole('button', { name: 'Confirmer la décision' }).click();
}

test('retry captures an explicit future time, reason and expected versions without delivering', async ({
  page,
}) => {
  const { writes, state } = await setup(page);
  await planRetry(page);
  await expect(drawer(page)).toBeHidden();
  await expect(panel(page)).toContainText('Nouvelle tentative');
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({
    target: 'RETRY_PLANNED',
    expectedVersion: 1,
    expectedPackageVersion: 3,
    expectedLoadUpdatedAt: stamp,
    note: 'Rendez-vous confirmé avec le destinataire.',
  });
  expect(Date.parse(writes[0].body.retryAt)).toBeGreaterThan(Date.now());
  expect(state.view.cases[0].package.status).toBe('LOADED');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
});

test('return authorization searches a real location and reception records the receiving person separately', async ({
  page,
}) => {
  const { writes, searches, state } = await setup(page);
  await panel(page).getByRole('button', { name: 'Traiter', exact: true }).click();
  await drawer(page).getByLabel('Décision').selectOption('RETURN_AUTHORIZED');
  await drawer(page).getByLabel('Rechercher un lieu de retour').fill('Laval');
  await drawer(page).getByRole('button', { name: 'Rechercher les lieux' }).click();
  await expect(
    drawer(page).getByLabel('Lieu de réception').locator('option[value="closed"]'),
  ).toHaveCount(0);
  await expect(drawer(page)).toContainText('lieux actifs parmi les 50 premiers résultats');
  await drawer(page).getByLabel('Lieu de réception').selectOption('depot');
  await drawer(page).getByLabel('Constat / justification').fill('Retour validé avec le client.');
  await drawer(page).getByRole('button', { name: 'Confirmer la décision' }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(panel(page)).toContainText('Retour autorisé');
  expect(searches).toEqual(['Laval']);
  expect(writes[0].body).toMatchObject({ target: 'RETURN_AUTHORIZED', returnLocationId: 'depot' });
  expect(state.view.cases[0].package.status).toBe('LOADED');
  await panel(page).getByRole('button', { name: 'Traiter', exact: true }).click();
  await expect(drawer(page)).toContainText('Aucun stock ni avoir ne sera créé.');
  await drawer(page).getByLabel('Personne ayant reçu le colis').fill('Alex Martin');
  await drawer(page)
    .getByLabel('Constat / justification')
    .fill('Colis reçu physiquement, quarantaine à décider.');
  await drawer(page).getByRole('button', { name: 'Confirmer la décision' }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(panel(page)).toContainText('Retour reçu');
  await expect(panel(page)).toContainText('Alex Martin');
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toMatchObject({
    target: 'RETURN_RECEIVED',
    receivedBy: 'Alex Martin',
    expectedVersion: 2,
  });
  expect(state.view.cases[0].package.status).toBe('RETURNED');
  await expect(panel(page).getByRole('button', { name: 'Traiter', exact: true })).toHaveCount(0);
});

test('read-only users retain incident history without mutation controls', async ({ page }) => {
  const { writes } = await setup(page, { manage: false });
  await expect(panel(page).getByRole('button', { name: 'Traiter', exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Signaler un incident' })).toHaveCount(0);
  await panel(page).getByText('Historique récent').click();
  await expect(panel(page)).toContainText('Signalé par le chauffeur.');
  expect(writes).toHaveLength(0);
});

test('location permissions remain explicit rather than exposing reference data', async ({
  page,
}) => {
  const { searches } = await setup(page, { locations: false });
  await panel(page).getByRole('button', { name: 'Traiter', exact: true }).click();
  await drawer(page).getByLabel('Décision').selectOption('RETURN_AUTHORIZED');
  await expect(drawer(page).getByRole('button', { name: 'Rechercher les lieux' })).toBeDisabled();
  await expect(drawer(page)).toContainText('exige le droit de lecture des référentiels Transport');
  expect(searches).toHaveLength(0);
});

test('uncertain accepted decision survives reload and replays exactly the same body and key', async ({
  page,
}) => {
  const { writes, state } = await setup(page);
  state.failAfterAccept = true;
  await planRetry(page);
  await expect(panel(page)).toContainText('Demande conservée');
  const saved = await page.evaluate((key) => sessionStorage.getItem(key), key);
  expect(saved).not.toBeNull();
  await page.reload();
  await expect(panel(page)).toContainText('Demande conservée');
  expect(writes).toHaveLength(1);
  await panel(page).getByRole('button', { name: 'Inspecter', exact: true }).click();
  await expect(panel(page)).toContainText('Nouvelle tentative');
  await panel(page).getByRole('button', { name: 'Reprendre la même demande' }).click();
  await expect(panel(page)).not.toContainText('Demande conservée');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(state.view.cases[0].version).toBe(2);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBeNull();
});

test('malformed success keeps intent instead of pretending that a decision is confirmed', async ({
  page,
}) => {
  const { writes, state } = await setup(page);
  state.malformed = true;
  await planRetry(page);
  await expect(drawer(page)).toContainText('Réponse incertaine');
  await expect(panel(page)).toContainText('Demande conservée');
  expect(writes).toHaveLength(1);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).not.toBeNull();
});

test('failed inspection hides stale cases and disables new actions without discarding the saved request', async ({
  page,
}) => {
  const { state } = await setup(page);
  state.failAfterAccept = true;
  await planRetry(page);
  await page.reload();
  await expect(panel(page)).toContainText('Demande conservée');
  state.failRead = true;
  await panel(page).getByRole('button', { name: 'Inspecter', exact: true }).click();
  await expect(panel(page)).toContainText('Lecture des incidents indisponible.');
  await expect(panel(page).getByRole('button', { name: 'Traiter', exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Signaler un incident' })).toBeDisabled();
  await expect(panel(page)).toContainText('Demande conservée');
});

test('mobile incident decision fits the viewport and explains the absence of automatic stock effects', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await panel(page).scrollIntoViewIfNeeded();
  await expect(panel(page)).toContainText('ni une remise en stock, ni un remboursement');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await panel(page).getByRole('button', { name: 'Traiter', exact: true }).click();
  await drawer(page).getByLabel('Décision').selectOption('RETURN_AUTHORIZED');
  await expect(drawer(page).getByLabel('Rechercher un lieu de retour')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('delivery-exception-mobile.png') });
});
