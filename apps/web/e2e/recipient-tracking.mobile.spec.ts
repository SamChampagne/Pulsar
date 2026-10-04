import { test, expect, type Page } from './fixtures';

// All API requests are intercepted. No real customer, capability or backend.
const at = '2026-10-02T14:15:00.000Z';
function trackingFixture(statuses = ['DELIVERED', 'LOADED', 'CANCELLED']) {
  const packages = statuses.map((status, index) => ({
    code: `PKG-${String(index + 1).padStart(6, '0')}`,
    status,
    loadedAt: ['LOADED', 'DELIVERED'].includes(status) ? at : null,
    deliveredAt: status === 'DELIVERED' ? at : null,
  }));
  return {
    shipper: 'Distribution Boréal',
    shipmentNumber: 'SH-RECIPIENT',
    status: 'IN_TRANSIT',
    origin: { city: 'Laval', state: 'QC', latitude: null, longitude: null },
    destination: { city: 'Québec', state: 'QC', latitude: null, longitude: null },
    plannedPickupEarly: at,
    plannedPickupLate: null,
    plannedDeliveryEarly: at,
    plannedDeliveryLate: null,
    actualPickupAt: at,
    actualDeliveryAt: null,
    lastPosition: null,
    proofOfDelivery: { signedByName: 'Camille Roy', signedAt: at },
    events: [
      { id: 'event-1', type: 'EXCEPTION', message: 'Un incident a été signalé.', occurredAt: at },
    ],
    packageTracking: {
      enabled: true,
      counts: {
        total: packages.length,
        active: packages.filter((p) => p.status !== 'CANCELLED').length,
        prepared: packages.filter((p) => p.status === 'PREPARED').length,
        loaded: packages.filter((p) => p.status === 'LOADED').length,
        delivered: packages.filter((p) => p.status === 'DELIVERED').length,
        cancelled: packages.filter((p) => p.status === 'CANCELLED').length,
      } as {
        total: number;
        active: number;
        prepared: number;
        loaded: number;
        delivered: number;
        cancelled: number;
      } | null,
      packages,
    },
  };
}

async function mock(page: Page, initial = trackingFixture()) {
  const state = { view: initial, error: false, reads: 0, writes: [] as string[] };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://**', (route) => route.abort());
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') state.writes.push(path);
    if (
      path.startsWith('/api/v1/public/tracking/') ||
      path === '/api/v1/portal/shipments/sh-recipient'
    ) {
      state.reads++;
      return state.error
        ? route.fulfill({
            status: 403,
            json: { message: 'Le suivi de cette expédition est indisponible.' },
          })
        : route.fulfill({ json: state.view });
    }
    if (path === '/api/v1/portal/view')
      return route.fulfill({
        json: {
          shipper: 'Distribution Boréal',
          customer: 'Atelier du Nord',
          branding: {},
          locations: [],
          orders: [],
        },
      });
    if (path === '/api/v1/portal/orders')
      return route.fulfill({
        json: {
          items: [
            {
              id: 'order-recipient',
              orderNumber: 'TO-RECIPIENT',
              customerReference: 'CMD-84',
              status: 'IN_EXECUTION',
              mode: 'FTL',
              createdAt: at,
              updatedAt: at,
              notes: null,
              totalWeightKg: 20,
              totalVolumeM3: null,
              palletCount: 1,
              requestedPickupEarly: at,
              requestedPickupLate: null,
              requestedDeliveryEarly: at,
              requestedDeliveryLate: null,
              originLocation: { city: 'Laval', state: 'QC' },
              destinationLocation: { city: 'Québec', state: 'QC' },
              shipments: [
                {
                  id: 'sh-recipient',
                  shipmentNumber: 'SH-RECIPIENT',
                  status: 'IN_TRANSIT',
                  plannedPickupEarly: at,
                  plannedPickupLate: null,
                  plannedDeliveryEarly: at,
                  plannedDeliveryLate: null,
                  actualPickupAt: at,
                  actualDeliveryAt: null,
                  documentCount: 0,
                  hasPod: true,
                  weightKg: 20,
                  palletCount: 1,
                  lastPosition: null,
                  trackingUrl: null,
                },
              ],
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      });
    return route.fulfill({ json: [] });
  });
  return state;
}

async function openPortal(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'pulsar.portal',
      JSON.stringify({
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
        user: {
          id: 'fixture-user',
          tenantId: 'fixture-tenant',
          customerId: 'fixture-customer',
          email: 'camille@example.test',
          firstName: 'Camille',
          lastName: 'Roy',
          role: 'MEMBER',
        },
        customer: { id: 'fixture-customer', name: 'Atelier du Nord' },
        shipper: { name: 'Distribution Boréal' },
        branding: {},
      }),
    ),
  );
  await page.goto('/portal/orders');
  await page.getByRole('cell', { name: 'TO-RECIPIENT', exact: true }).click();
  await page.getByRole('button', { name: 'Suivre', exact: true }).click();
  return page.getByRole('dialog', { name: 'Suivi SH-RECIPIENT' });
}

test('mobile recipient separates partial physical delivery from the existing POD', async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto('/track/fixture-recipient');
  const panel = page.getByTestId('recipient-packages');
  await expect(panel.getByText('Livraison partielle')).toBeVisible();
  await expect(panel.getByText('sur 2 colis actifs livrés')).toBeVisible();
  await expect(panel.getByText('PKG-000003', { exact: true })).toBeVisible();
  await expect(panel.getByText('Exclu du nombre de colis actifs.')).toBeVisible();
  await expect(page.getByText('Preuve de livraison enregistrée', { exact: false })).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/recipient-mobile.png', fullPage: true });
  expect(state.writes).toEqual([]);
});

test('desktop recipient retains the same restrained package hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await mock(page);
  await page.goto('/track/fixture-desktop');
  await expect(
    page.getByTestId('recipient-packages').getByText('sur 2 colis actifs livrés'),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/recipient-desktop.png', fullPage: true });
});

test('legacy shipments say tracking is not enabled without a fabricated zero', async ({ page }) => {
  const data = trackingFixture([]);
  data.packageTracking = { enabled: false, counts: null, packages: [] };
  await mock(page, data);
  await page.goto('/track/fixture-legacy');
  const panel = page.getByTestId('recipient-packages');
  await expect(panel.getByText('Suivi par colis non activé')).toBeVisible();
  await expect(panel.getByText(/sur \d+ colis actifs livrés/)).toHaveCount(0);
  await expect(panel.getByText('Aucun colis déclaré pour le moment')).toHaveCount(0);
});

test('an enabled empty manifest is distinct from legacy tracking', async ({ page }) => {
  await mock(page, trackingFixture([]));
  await page.goto('/track/fixture-empty');
  const panel = page.getByTestId('recipient-packages');
  await expect(panel.getByText('Aucun colis déclaré pour le moment')).toBeVisible();
  await expect(panel.getByText(/sur \d+ colis actifs livrés/)).toHaveCount(0);
});

test('cancelled-only packages never claim a completed delivery', async ({ page }) => {
  await mock(page, trackingFixture(['CANCELLED']));
  await page.goto('/track/fixture-cancelled');
  const panel = page.getByTestId('recipient-packages');
  await expect(panel.getByText('Aucun colis actif', { exact: true })).toBeVisible();
  await expect(panel.getByText(/Annulé$/)).toBeVisible();
  await expect(panel.getByText('Livraison partielle')).toHaveCount(0);
  await expect(panel.getByText(/sur \d+ colis actifs livrés/)).toHaveCount(0);
});

test('public errors hide old package data and retry only on explicit action', async ({ page }) => {
  const state = await mock(page);
  await page.goto('/track/fixture-error');
  await expect(page.getByText('PKG-000001', { exact: true })).toBeVisible();
  state.error = true;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Le suivi de cette expédition est indisponible.',
  );
  await expect(page.getByTestId('recipient-packages')).toHaveCount(0);
  expect(state.reads).toBe(2);
  state.error = false;
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByText('PKG-000001', { exact: true })).toBeVisible();
  expect(state.reads).toBe(3);
  expect(state.writes).toEqual([]);
});

test('portal detail reuses the exact recipient panel, without POD notes', async ({ page }) => {
  const state = await mock(page);
  const dialog = await openPortal(page);
  await expect(
    dialog.getByTestId('recipient-packages').getByText('Livraison partielle'),
  ).toBeVisible();
  await expect(dialog.getByText('sur 2 colis actifs livrés')).toBeVisible();
  await expect(dialog.getByText('Camille Roy', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/recipient-portal-mobile.png', fullPage: true });
  expect(state.writes).toEqual([]);
});

test('portal tracking errors do not create an automatic retry loop', async ({ page }) => {
  const state = await mock(page);
  state.error = true;
  const dialog = await openPortal(page);
  await expect(dialog.getByRole('alert')).toContainText(
    'Le suivi de cette expédition est indisponible.',
  );
  expect(state.reads).toBe(1);
  state.error = false;
  await dialog.getByRole('button', { name: 'Réessayer' }).click();
  await expect(dialog.getByTestId('recipient-packages')).toBeVisible();
  expect(state.reads).toBe(2);
});
