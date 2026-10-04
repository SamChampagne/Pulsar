import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';
import { fulfillUnmockedDeliveryPanel } from './delivery-fixtures';

test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});
async function setup(
  page: Page,
  options: {
    readOnly?: boolean;
    inTransit?: boolean;
    unknownResponse?: boolean;
    deniedRetry?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ readOnly }) => {
      if (!['http:', 'https:'].includes(window.location.protocol)) return;
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
              'transportation.planning.read',
              'transportation.execution.read',
              ...(readOnly
                ? []
                : ['transportation.planning.manage', 'transportation.execution.manage']),
            ],
          },
          tenant: {
            id: 'fuel-fixture',
            name: 'Recette locale',
            slug: 'fuel-fixture',
            enabledModules: ['transportation'],
          },
        }),
      );
    },
    { readOnly: !!options.readOnly },
  );
  const writes: { path: string; body: any }[] = [];
  const stamp = '2026-10-02T12:00:00.000Z';
  const profile = {
    id: 'profile',
    revision: 1,
    createdAt: stamp,
    snapshot: {
      loadedLitersPer100Km: 35,
      emptyLitersPer100Km: 25,
      idleLitersPerHour: 3,
      tankCapacityLitres: 600,
      reserveLitres: 60,
    },
  };
  const price = {
    id: 'price',
    revision: 1,
    createdAt: stamp,
    snapshot: {
      effectiveOn: '2026-10-01',
      pricePerLitre: '1.65',
      currency: 'CAD',
      reference: 'Prix local vérifié',
    },
  };
  const load = {
    id: 'fixture',
    loadNumber: 'LD-RECETTE',
    updatedAt: stamp,
    status: options.inTransit ? 'IN_TRANSIT' : 'PLANNED',
    vehicleId: 'vehicle',
    vehicle: { id: 'vehicle', unitNumber: 'TR-401' },
    driver: null,
    carrier: null,
    trailer: null,
    rate: null,
    mode: 'FTL',
    notes: null,
    estimatedCost: null,
    costDetail: null,
    costCurrency: null,
    accessorials: [],
    shipments: [],
    route: null,
  };
  const context: any = {
    load,
    route: options.inTransit
      ? {
          id: 'route',
          updatedAt: stamp,
          deliveryPlan: {
            version: 1,
            options: { startAt: stamp },
            totals: { distanceKm: 200, liters: 60, fuelCost: 99, currency: 'CAD' },
          },
        }
      : null,
    profile,
    latestPriceRevision: 1,
    actual: null,
  };
  let failed = false;
  let denied = false;
  await page.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  await page.route('**/api/v1/**', async (r) => {
    const req = r.request(),
      path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') writes.push({ path, body: req.postDataJSON() });
    if (path === '/api/v1/transportation/delivery-fuel/loads/fixture')
      return r.fulfill({ json: context });
    if (path === '/api/v1/transportation/delivery-fuel/prices')
      return r.fulfill({ json: { items: [price], total: 1, page: 1, pageSize: 20 } });
    if (
      path === '/api/v1/transportation/delivery-fuel/vehicles/vehicle/profile' &&
      req.method() === 'POST'
    ) {
      const body = req.postDataJSON();
      if (failed && options.deniedRetry && !denied) {
        denied = true;
        return r.fulfill({ status: 403, json: { message: 'Module momentanément désactivé.' } });
      }
      context.profile = { ...profile, revision: 2, snapshot: body.profile };
      if (options.unknownResponse && !failed) {
        failed = true;
        return r.abort('failed');
      }
      return r.fulfill({ status: 201, json: { operationKey: body.operationKey, revision: 2 } });
    }
    if (
      path === '/api/v1/transportation/delivery-fuel/loads/fixture/actuals' &&
      req.method() === 'POST'
    ) {
      const body = req.postDataJSON();
      context.actual = {
        id: 'actual',
        revision: 1,
        createdAt: stamp,
        snapshot: {
          ...body.actual,
          baseline: {
            routeId: 'route',
            routeUpdatedAt: stamp,
            deliveryPlan: context.route.deliveryPlan,
          },
        },
        comparison: {
          planned: { distanceKm: 200, litres: 60, costAmount: 99, currency: 'CAD' },
          deltaDistanceKm: 5,
          deltaLitres: 1,
          deltaCostAmount: null,
          costComparable: false,
        },
      };
      return r.fulfill({ status: 201, json: { operationKey: body.operationKey, revision: 1 } });
    }
    if (path === '/api/v1/transportation/loads/fixture') return r.fulfill({ json: load });
    if (path.endsWith('/accessorials'))
      return r.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } });
    if (path.endsWith('/manifests') || path.endsWith('/driver-documents'))
      return r.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 5 } });
    if (path.endsWith('/delivery-packages')) return r.fulfill({ json: { load, shipments: [] } });
    if (await fulfillUnmockedDeliveryPanel(r)) return;
    return r.fulfill({
      json: path.endsWith('/preferences')
        ? EXPERIENCED_PREFERENCES
        : path.endsWith('/unseen-count')
          ? { count: 0 }
          : [],
    });
  });
  await page.goto('/loads/fixture');
  await expect(
    page.getByRole('heading', { name: 'Carburant de la tournée', exact: true }),
  ).toBeVisible();
  return { writes, context };
}
test('requires explicit price selection and only applies assumptions to a draft', async ({
  page,
}, info) => {
  const { writes } = await setup(page);
  const panel = page.getByRole('region', { name: 'Carburant de la tournée' });
  const apply = panel.getByRole('button', { name: 'Appliquer au brouillon de tournée' });
  await expect(apply).toBeDisabled();
  await page.getByLabel('Révision de prix carburant', { exact: true }).selectOption('price');
  await page.getByLabel('Date de référence carburant UTC', { exact: true }).fill('2026-10-02');
  await apply.click();
  await page.getByRole('button', { name: 'Appliquer au brouillon', exact: true }).click();
  await expect(page.getByLabel('Consommation chargé (L/100 km)', { exact: true })).toHaveValue(
    '35',
  );
  expect(writes).toHaveLength(0);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('fuel-desktop.png') });
});
test('retains the exact operation across uncertain response and page reload', async ({ page }) => {
  const { writes } = await setup(page, { unknownResponse: true });
  await page.getByRole('button', { name: 'Réviser le profil', exact: true }).click();
  await page.getByLabel('Réserve (L)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Enregistrer la révision', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer la déclaration' })
    .getByRole('button', { name: 'Enregistrer la révision', exact: true })
    .click();
  await expect(page.getByRole('alert').filter({ hasText: 'Résultat incertain' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reprendre la même demande', exact: true }),
  ).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].body.expectedRevision).toBe(1);
});
test('records explicit cumulative actual and preserves unknown cost on mobile', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes } = await setup(page, { inTransit: true });
  await page.getByRole('button', { name: 'Déclarer les totaux réels', exact: true }).click();
  await page.getByLabel('Distance totale (km)', { exact: true }).fill('205');
  await page.getByLabel('Litres consommés (total)', { exact: true }).fill('61');
  await page
    .getByLabel('Méthode et portée du relevé', { exact: true })
    .fill('Total compteur manuel; coût non connu');
  await page.getByRole('button', { name: 'Enregistrer la révision', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer la déclaration' })
    .getByRole('button', { name: 'Enregistrer la révision', exact: true })
    .click();
  await expect(page.getByText('Réel déclaré · révision 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toHaveLength(1);
  expect(writes[0].body.actual.costAmount).toBeNull();
  expect(writes[0].body.actual.currency).toBeNull();
  expect(writes[0].body.expectedRouteUpdatedAt).toBe('2026-10-02T12:00:00.000Z');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('region', { name: 'Carburant de la tournée' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('fuel-mobile.png'), fullPage: true });
});
test('keeps an uncertain request even if the next retry is denied', async ({ page }) => {
  const { writes } = await setup(page, { unknownResponse: true, deniedRetry: true });
  await page.getByRole('button', { name: 'Réviser le profil', exact: true }).click();
  await page.getByLabel('Réserve (L)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Enregistrer la révision', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer la déclaration' })
    .getByRole('button', { name: 'Enregistrer la révision', exact: true })
    .click();
  await expect(page.getByRole('alert').filter({ hasText: 'Résultat incertain' })).toBeVisible();
  await page.reload();
  const retry = page.getByRole('button', { name: 'Reprendre la même demande', exact: true });
  await retry.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Demande conservée' })).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Réviser le profil', exact: true })).toBeDisabled();
  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(writes).toHaveLength(3);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[2]).toEqual(writes[0]);
});
test('read-only operators cannot publish profiles/prices/actuals', async ({ page }) => {
  const { writes } = await setup(page, { readOnly: true });
  for (const name of [
    'Réviser le profil',
    'Ajouter un prix',
    'Déclarer les totaux réels',
    'Appliquer au brouillon de tournée',
  ])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(0);
});
