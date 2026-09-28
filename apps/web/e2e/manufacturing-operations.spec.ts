import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';

async function settleDrawer(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('dialog').locator('..')).toHaveCSS('opacity', '1');
}

async function setup(
  page: Page,
  options: { lose?: boolean; readonly?: boolean; conflict?: boolean } = {},
) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (readonly) =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'fixture',
          refreshToken: '',
          user: {
            id: 'operator',
            firstName: 'Atelier',
            lastName: 'Test',
            email: 'test@example.test',
            permissions: [
              'manufacturing.read',
              'wms.read',
              ...(readonly ? [] : ['manufacturing.manage', 'wms.manage']),
            ],
          },
          tenant: {
            id: 'fixture',
            name: 'Atelier test',
            slug: 'fixture',
            enabledModules: ['manufacturing', 'wms'],
          },
        }),
      ),
    !!options.readonly,
  );
  const snapshot = {
    version: 'pulsar.manufacturing.materials.v1',
    revisionId: 'rev',
    revision: 1,
    contentHash: 'abc',
    locationId: 'site',
    capturedAt: '2026-10-01',
    product: { itemId: 'fg', sku: 'FG', name: 'Support acier', unit: 'EA', quantity: '10' },
    components: [
      {
        itemId: 'raw',
        sku: 'RAW',
        name: 'Acier',
        unit: 'KG',
        quantityPerUnit: '2',
        requiredQuantity: '20',
      },
    ],
  };
  const order = {
    id: 'of',
    number: 'OF-000021',
    name: 'Supports client',
    quantity: 10,
    productRef: 'FG',
    status: 'IN_PROGRESS',
    priority: 'NORMAL',
    firmness: 'FIRM',
    updatedAt: '2026-10-01T00:00:00Z',
    locationId: 'site',
    location: { name: 'Atelier Montréal' },
    materialSnapshot: snapshot,
    operations: [],
    dueDate: '2026-10-15',
    releaseDate: '2026-10-01',
  };
  const floor = {
    ...order,
    siteName: 'Atelier Montréal',
    good: 0,
    scrap: 0,
    remaining: 10,
    declarations: [] as any[],
  };
  const impact = {
    id: 'of',
    number: order.number,
    name: order.name,
    status: 'RELEASED',
    state: 'WAITING',
    targetDate: '2026-10-01',
    readyDate: '2026-10-04',
    delayDays: 3,
    hasActuals: false,
    components: [
      {
        itemId: 'raw',
        sku: 'RAW',
        name: 'Acier',
        unit: 'KG',
        quantity: '20',
        shortage: '0',
        sources: [{ purchaseId: 'po', date: '2026-10-04', quantity: '20' }],
      },
    ],
  };
  const state = { writes: [] as any[], lost: false };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/me/preferences') return route.fulfill({ json: EXPERIENCED_PREFERENCES });
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON();
      state.writes.push(body);
      if (options.conflict)
        return route.fulfill({ status: 409, json: { message: 'Stock insuffisant. Rechargez.' } });
      if (options.lose && !state.lost) {
        state.lost = true;
        return route.abort('failed');
      }
      floor.good = body.goodQuantity;
      floor.scrap = body.scrapQuantity;
      floor.remaining = 10 - floor.good - floor.scrap;
      floor.declarations = [
        {
          id: 'declaration',
          goodQuantity: floor.good,
          scrapQuantity: floor.scrap,
          note: body.note,
          createdAt: '2026-10-02T12:00:00Z',
          evidence: { movements: [{ id: 'm1' }, { id: 'm2' }] },
        },
      ];
      return route.fulfill({ json: { id: 'declaration' } });
    }
    if (path === '/manufacturing/orders/of') return route.fulfill({ json: order });
    if (path === '/manufacturing/shop-floor/orders/of') return route.fulfill({ json: floor });
    if (path === '/wms/items/fg' || path === '/wms/items/raw')
      return route.fulfill({
        json: { lotTracked: false, unit: path.endsWith('/fg') ? 'EA' : 'KG' },
      });
    if (path.endsWith('/bins'))
      return route.fulfill({ json: { items: [{ id: 'bin', code: 'ATELIER-A' }], total: 1 } });
    if (path === '/wms/sites')
      return route.fulfill({
        json: { items: [{ id: 'site', name: 'Atelier Montréal' }], total: 1 },
      });
    if (path.endsWith('/material-impact'))
      return route.fulfill({
        json: {
          site: { id: 'site', name: 'Atelier Montréal' },
          asOf: '2026-10-01',
          baselineId: null,
          orders: [impact],
          unassessedOrders: [],
          arrivals: [
            { id: 'po', preparationId: 'prep', number: 'MP-000001', expectedDate: '2026-10-04' },
          ],
          guidance: 'Simulation sans réservation. Les retards exigent un nouveau calcul APS.',
        },
      });
    return route.fulfill({ json: path.endsWith('/notifications') ? [] : { items: [], total: 0 } });
  });
  return { state, errors };
}
async function openFloor(page: Page) {
  await page.goto('/manufacturing/orders/of');
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Déclarer ce qui a réellement été fait' }),
  ).toBeVisible();
  return dialog;
}
async function fillFloor(page: Page) {
  const dialog = await openFloor(page);
  await dialog.getByLabel('Quantité bonne', { exact: true }).fill('8');
  await dialog.getByLabel('Quantité rebutée', { exact: true }).fill('2');
  await dialog.getByLabel('Destination des produits finis').selectOption('bin');
  await dialog.getByLabel('Consommation réelle RAW').fill('20');
  await dialog.getByLabel('Emplacement source RAW').selectOption('bin');
  await dialog
    .getByLabel('Note d’atelier / écarts / rebuts')
    .fill('Deux pièces rebutées après contrôle');
  await expect(
    dialog.getByRole('button', { name: 'Valider la déclaration et le stock' }),
  ).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /Je confirme les quantités/ }).check();
  return dialog;
}
test('shows material delays and links their supplier proof and order without writing', async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  await page.goto('/manufacturing/materials');
  await page.getByLabel('Entrepôt de fabrication').selectOption('site');
  await page.getByRole('button', { name: 'Analyser les impacts' }).click();
  await expect(page.getByText(/Disponibilité : 2026-10-04/)).toBeVisible();
  await page.getByRole('button', { name: /OF-000021/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', { name: 'MP-000001' })).toHaveAttribute(
    'href',
    '/manufacturing/purchasing?preparationId=prep',
  );
  await expect(dialog.getByRole('link', { name: 'Ouvrir l’OF et l’atelier' })).toHaveAttribute(
    'href',
    '/manufacturing/orders/of',
  );
  await settleDrawer(page);
  await page.screenshot({ path: 'test-results/material-impact-desktop.png', fullPage: true });
  expect(state.writes).toEqual([]);
  expect(errors).toEqual([]);
});
test('declares actual consumption and scrap and links the resulting WMS journal', async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  const dialog = await fillFloor(page);
  await settleDrawer(page);
  await page.screenshot({ path: 'test-results/shop-floor-desktop.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Valider la déclaration et le stock' }).click();
  // Refreshing the order must leave the workshop open with its server proof.
  await expect(dialog.getByRole('link', { name: 'Voir les 2 mouvements →' })).toHaveAttribute(
    'href',
    '/wms/movements?refType=manufacturing-declaration&refId=declaration',
  );
  expect(state.writes[0]).toMatchObject({
    goodQuantity: 8,
    scrapQuantity: 2,
    consumptions: [{ itemId: 'raw', fromBinId: 'bin', quantity: '20' }],
  });
  expect(errors).toEqual([]);
});
test('preserves the exact declaration key across lost response and page reload', async ({
  page,
}) => {
  const { state } = await setup(page, { lose: true });
  let dialog = await fillFloor(page);
  await dialog.getByRole('button', { name: 'Valider la déclaration et le stock' }).click();
  await expect(dialog.getByRole('button', { name: 'Reprendre la même déclaration' })).toBeVisible();
  const original = state.writes[0];
  await page.reload();
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Reprendre la même déclaration' }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1]).toEqual(original);
});
test('preserves form input after a stock conflict and requires refresh', async ({ page }) => {
  await setup(page, { conflict: true });
  const dialog = await fillFloor(page);
  await dialog.getByRole('button', { name: 'Valider la déclaration et le stock' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Stock insuffisant');
  await expect(dialog.getByLabel('Quantité bonne', { exact: true })).toHaveValue('8');
  await expect(
    dialog.getByRole('button', { name: 'Valider la déclaration et le stock' }),
  ).toBeDisabled();
});
test('keeps the workshop read-only and fits a phone viewport', async ({ page }) => {
  const { state, errors } = await setup(page, { readonly: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/manufacturing/orders/of');
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Déclarations et preuves WMS' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Valider la déclaration et le stock' }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settleDrawer(page);
  await page.screenshot({ path: 'test-results/shop-floor-mobile.png', fullPage: true });
  expect(state.writes).toEqual([]);
  expect(errors).toEqual([]);
});
