import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';
import { fulfillUnmockedDeliveryPanel } from './delivery-fixtures';
import type { DeliveryAllocationWorkspace } from '@pulsar/shared';

const stamp = '2026-10-03T12:00:00.000Z';
const base = '/api/v1/transportation/delivery-allocation';
const pendingKey = 'pulsar.delivery-allocation.pending.v1:fixture:operator:fixture';
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});
const panel = (page: Page) => page.getByRole('region', { name: 'Traçabilité des quantités' });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Relier une ligne de colis' });
function fixture(): DeliveryAllocationWorkspace {
  return {
    shipment: { id: 's', shipmentNumber: 'SH-AXES', status: 'PLANNED', updatedAt: stamp },
    access: { sales: true, picking: true },
    salesLines: [
      {
        id: 'sl',
        kind: 'sales',
        name: 'Axes usinés',
        documentNumber: 'SO-42',
        siteId: null,
        siteName: null,
        quantity: '5.125',
        unit: null,
        updatedAt: stamp,
        orderUpdatedAt: stamp,
        status: 'CONFIRMED',
        selectable: true,
        totals: null,
      },
    ],
    pickLines: [
      {
        id: 'pl',
        kind: 'pick',
        name: 'AX-84 · Axes usinés',
        documentNumber: 'PK-87',
        siteId: 'site',
        siteName: 'Atelier Laval',
        quantity: '5.125',
        unit: 'pièce',
        updatedAt: stamp,
        status: 'COMPLETED',
        selectable: true,
        totals: {
          allocated: '0',
          delivered: '0',
          returned: '0',
          remainingToAllocate: '5.125',
          remainingToDeliver: '5.125',
        },
      },
    ],
    allocations: [],
    packages: [
      {
        id: 'p',
        code: 'PKG-0001',
        status: 'PREPARED',
        version: 1,
        canAllocate: true,
        lockedContentIndices: [],
        contents: [
          { reference: 'AX-84', description: 'Axes usinés', quantity: '2.125', unit: 'pièce' },
        ],
      },
    ],
  };
}
async function setup(page: Page, options: { manage?: boolean; sources?: boolean } = {}) {
  const manage = options.manage ?? true;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ manage }) =>
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
              'crm.read',
              'wms.read',
              ...(manage ? ['transportation.planning.manage'] : []),
            ],
          },
          tenant: {
            id: 'fixture',
            name: 'Composants du Nord',
            slug: 'fixture',
            enabledModules: ['transportation', 'crm', 'wms'],
          },
        }),
      ),
    { manage },
  );
  const state = {
    view: fixture(),
    failAfterAccept: false,
    conflict: false,
    failRead: false,
    malformed: false,
  };
  if (options.sources === false) {
    state.view.access = { sales: false, picking: false };
    state.view.salesLines = [];
    state.view.pickLines = [];
  }
  const writes: { path: string; body: any }[] = [];
  const receipts = new Map<string, unknown>();
  await page.route('**/tile.openstreetmap.org/**', (route) => route.abort());
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path.startsWith(base)) {
      if (request.method() === 'GET')
        return route.fulfill(
          state.failRead
            ? { status: 503, json: { message: 'Lecture indisponible' } }
            : { json: state.view },
        );
      const body = request.postDataJSON();
      writes.push({ path, body });
      if (state.conflict)
        return route.fulfill({ status: 409, json: { message: 'Le colis a changé. Rechargez.' } });
      if (receipts.has(body.operationKey))
        return route.fulfill({ json: receipts.get(body.operationKey) });
      const released = path.endsWith('/release');
      const pkg = state.view.packages[0];
      pkg.version++;
      if (released) {
        state.view.allocations[0].releasedAt = stamp;
        state.view.allocations[0].canRelease = false;
        pkg.lockedContentIndices = [];
      } else {
        pkg.lockedContentIndices = [0];
        state.view.allocations.push({
          id: 'a1',
          packageId: 'p',
          contentIndex: 0,
          quantity: '2.125',
          unit: 'pièce',
          sourceSalesOrderLineId: body.sourceSalesOrderLineId ?? null,
          sourcePickLineId: body.sourcePickLineId ?? null,
          salesLabel: body.sourceSalesOrderLineId ? 'SO-42 · Axes usinés' : null,
          pickLabel: body.sourcePickLineId ? 'PK-87 · Axes usinés' : null,
          createdAt: stamp,
          releasedAt: null,
          canRelease: true,
        });
      }
      const receipt = {
        operationKey: body.operationKey,
        allocationId: 'a1',
        packageId: 'p',
        version: pkg.version,
        released,
      };
      receipts.set(body.operationKey, receipt);
      if (state.failAfterAccept) {
        state.failAfterAccept = false;
        return route.abort('failed');
      }
      return route.fulfill({ json: state.malformed ? { ok: true } : receipt });
    }
    if (path === '/api/v1/transportation/loads/fixture')
      return route.fulfill({
        json: {
          id: 'fixture',
          loadNumber: 'LD-RECETTE',
          updatedAt: stamp,
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
              id: 's',
              shipmentNumber: 'SH-AXES',
              status: 'PLANNED',
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
          load: { id: 'fixture', loadNumber: 'LD-RECETTE', status: 'PLANNED', updatedAt: stamp },
          shipments: [
            {
              ...state.view.shipment,
              packageTrackingEnabledAt: stamp,
              originName: 'Atelier Laval',
              destinationName: 'Usine Québec',
              packages: state.view.packages.map((p) => ({
                ...p,
                label: '',
                loadedAt: null,
                deliveredAt: null,
                updatedAt: stamp,
              })),
            },
          ],
        },
      });
    if (
      path.endsWith('/manifests') ||
      path.endsWith('/driver-documents') ||
      path.endsWith('/accessorials')
    )
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
  await expect(
    panel(page).getByRole('heading', { name: 'De la commande à la livraison' }),
  ).toBeVisible();
  await expect(panel(page).getByRole('heading', { name: 'PKG-0001' })).toBeVisible();
  return { state, writes };
}
async function choose(page: Page, source: 'sales' | 'pick' | 'both' = 'pick') {
  await panel(page).getByRole('button', { name: 'Relier la ligne 1' }).click();
  if (source !== 'pick')
    await drawer(page).getByLabel('Ligne de commande CRM (facultatif)').selectOption('sl');
  if (source !== 'sales')
    await drawer(page).getByLabel('Ligne de préparation terminée (facultatif)').selectOption('pl');
}
test('explicit CRM attestation and matching preparation, quantities remain exact', async ({
  page,
}) => {
  const { writes } = await setup(page);
  await choose(page, 'both');
  await expect(drawer(page)).toContainText('2.125 pièce');
  await expect(
    drawer(page).getByRole('button', { name: 'Confirmer l’attribution' }),
  ).toBeDisabled();
  await drawer(page).getByRole('checkbox').check();
  await drawer(page).getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(panel(page)).toContainText('Source attribuée');
  expect(writes[0].body).toMatchObject({
    packageId: 'p',
    contentIndex: 0,
    expectedVersion: 1,
    sourceSalesOrderLineId: 'sl',
    sourcePickLineId: 'pl',
    salesUnitAcknowledged: true,
    expectedSalesLineUpdatedAt: stamp,
    expectedSalesOrderUpdatedAt: stamp,
    expectedPickUpdatedAt: stamp,
  });
  expect(writes).toHaveLength(1);
});
test('WMS-only attribution does not send a commercial attestation', async ({ page }) => {
  const { writes } = await setup(page);
  await choose(page);
  await expect(drawer(page).getByRole('checkbox')).toHaveCount(0);
  await drawer(page).getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(panel(page)).toContainText('Source attribuée');
  expect(writes[0].body.sourceSalesOrderLineId).toBeUndefined();
  expect(writes[0].body.salesUnitAcknowledged).toBeUndefined();
});
test('transport alone explains optional dependencies and offers no false source', async ({
  page,
}) => {
  const { writes } = await setup(page, { sources: false });
  await expect(panel(page)).toContainText('Vous pouvez continuer la livraison sans ces liens.');
  await expect(panel(page).getByRole('button', { name: 'Relier la ligne 1' })).toBeDisabled();
  expect(writes).toHaveLength(0);
});
test('read-only users see context without attribution actions', async ({ page }) => {
  const { writes } = await setup(page, { manage: false });
  await expect(panel(page)).toContainText('Commandé');
  await expect(
    panel(page).getByRole('button', { name: /Relier la ligne|Libérer le lien/ }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(0);
});
test('response loss preserves exact intent across reload and explicit replay', async ({ page }) => {
  const { state, writes } = await setup(page);
  state.failAfterAccept = true;
  await choose(page);
  await drawer(page).getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(panel(page)).toContainText('Une demande attend vérification');
  await page.reload();
  await expect(
    panel(page).getByRole('button', { name: 'Reprendre la même demande' }),
  ).toBeDisabled();
  await panel(page).getByRole('button', { name: 'Inspecter les liens' }).click();
  await panel(page).getByRole('button', { name: 'Reprendre la même demande' }).click();
  await expect(panel(page).getByText('Une demande attend vérification')).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toEqual(writes[0].body);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).toBeNull();
});
test('conflict keeps pending intention and requires inspection', async ({ page }) => {
  const { state, writes } = await setup(page);
  state.conflict = true;
  await choose(page);
  await drawer(page).getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(drawer(page)).toContainText('Le colis a changé');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).not.toBeNull();
  expect(writes).toHaveLength(1);
});
test('release has a deliberate confirmation and preserves visible history', async ({ page }) => {
  const { writes } = await setup(page);
  await choose(page);
  await drawer(page).getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await panel(page).getByRole('button', { name: 'Libérer le lien' }).click();
  expect(writes).toHaveLength(1);
  await page
    .getByRole('dialog', { name: 'Libérer cette attribution ?' })
    .getByRole('button', { name: 'Libérer le lien', exact: true })
    .click();
  await expect(panel(page)).toContainText('Lien libéré');
  expect(writes).toHaveLength(2);
  expect(writes[1].body.expectedVersion).toBe(2);
});
test('mobile remains readable without horizontal overflow and explains returned capacity', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await panel(page).scrollIntoViewIfNeeded();
  await expect(panel(page)).toContainText('Un retour ne libère pas une quantité');
  expect(await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({
    path: info.outputPath('delivery-allocation-mobile.png'),
    animations: 'disabled',
  });
  await choose(page, 'sales');
  await expect(drawer(page).getByRole('checkbox')).toBeVisible();
  expect(await drawer(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});
