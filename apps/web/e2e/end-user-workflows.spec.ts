import { test, expect, type Page } from '@playwright/test';
import { TOUR_MODULE_KEYS } from '@pulsar/shared';

// Controlled API fixtures: no business data or external messages are written.
const permissions = [
  'transportation.master-data.read',
  'transportation.master-data.manage',
  'transportation.planning.read',
  'transportation.planning.manage',
  'customer-portal.links.manage',
  'core.locations.read',
  'core.locations.manage',
  'wms.read',
  'wms.manage',
  'manufacturing.read',
  'manufacturing.manage',
];
async function session(page: Page, perms = permissions) {
  await page.addInitScript(
    ({ perms }) =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
          user: {
            id: 'test-user',
            firstName: 'Camille',
            lastName: 'Test',
            email: 'test@example.invalid',
            permissions: perms,
          },
          tenant: {
            id: 'test-tenant',
            slug: 'test',
            name: 'Atelier Test',
            enabledModules: ['transportation', 'customer-portal', 'wms', 'manufacturing'],
          },
        }),
      ),
    { perms },
  );
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith('/preferences')
        ? {
            appearance: null,
            deskLayout: null,
            moduleTours: Object.fromEntries(
              TOUR_MODULE_KEYS.map((k) => [k, { version: 1, step: 4, status: 'COMPLETED' }]),
            ),
          }
        : path.endsWith('unseen-count')
          ? { count: 0 }
          : [],
    });
  });
  page.on('pageerror', (error) => {
    throw error;
  });
}
const customer = {
  id: 'c1',
  code: 'CLI-1',
  name: 'Atelier Nord',
  contactName: 'Camille',
  email: 'info@example.invalid',
  phone: '5145550123',
  isActive: true,
};
const carrier = {
  id: 'tr1',
  code: 'TR-1',
  name: 'Transport Est',
  contactName: 'Alex',
  email: 'dispatch@example.invalid',
  phone: '5145550123',
  scacCode: 'ABCD',
  status: 'ACTIVE',
};
function list(items: unknown[]) {
  return { items, total: items.length, page: 1, pageSize: 25 };
}

test('client: edit, clear a field and confirm deactivation', async ({ page }) => {
  await session(page);
  let updated: Record<string, unknown> = {};
  await page.route('**/api/v1/transportation/customers**', async (route) => {
    if (route.request().method() === 'PATCH') {
      updated = route.request().postDataJSON();
      return route.fulfill({ json: { ...customer, ...updated } });
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/c1')
        ? { ...customer, ...updated }
        : list([{ ...customer, ...updated }]),
    });
  });
  await page.route('**/api/v1/customer-portal/branding', (r) => r.fulfill({ json: {} }));
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifier le client' });
  await dialog.getByLabel('Nom', { exact: true }).fill('Atelier Boréal');
  await dialog.getByLabel('Courriel', { exact: true }).fill('');
  await dialog.getByLabel('Client actif').uncheck();
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(updated).toMatchObject({ name: 'Atelier Boréal', email: null, isActive: false });
  await expect(page.getByRole('cell', { name: 'Inactif', exact: true })).toBeVisible();
});

test('carrier: reject text phone, preserve form, save correction', async ({ page }) => {
  await session(page);
  let writes = 0;
  await page.route('**/api/v1/transportation/carriers**', (route) => {
    if (route.request().method() === 'PATCH') {
      writes++;
      return route.fulfill({ json: carrier });
    }
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/tr1') ? carrier : list([carrier]),
    });
  });
  await page.goto('/carriers');
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifier le transporteur' });
  await dialog.getByLabel('Téléphone').fill('bonjour');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Téléphone invalide');
  expect(writes).toBe(0);
  await dialog.getByLabel('Téléphone').fill('+1 514 555-0134 poste 22');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toBe(1);
});

test('read-only users cannot see create/edit actions', async ({ page }) => {
  await session(page, ['transportation.master-data.read']);
  await page.route('**/api/v1/transportation/customers**', (route) =>
    route.fulfill({ json: list([customer]) }),
  );
  await page.goto('/customers');
  await expect(page.getByText('Atelier Nord')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modifier', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nouveau client' })).toHaveCount(0);
});

test('Enter advances operational fields without creating a record', async ({ page }) => {
  await session(page);
  let writes = 0;
  await page.route('**/api/v1/transportation/carriers**', (route) => {
    if (route.request().method() === 'POST') writes++;
    return route.fulfill({ json: list([]) });
  });
  await page.goto('/carriers');
  await page.getByRole('button', { name: 'Nouveau transporteur' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau transporteur' });
  await dialog.getByLabel('Code', { exact: true }).fill('TR-2');
  await page.keyboard.press('Enter');
  await expect(dialog.getByLabel('Nom', { exact: true })).toBeFocused();
  expect(writes).toBe(0);
  await page.keyboard.press('Shift+Enter');
  await expect(dialog.getByLabel('Code', { exact: true })).toBeFocused();
});

test('fuel help explains the business chain and offers a replayable module guide', async ({
  page,
}) => {
  await session(page);
  await page.route('**/api/v1/transportation/fuel-tables**', (r) => r.fulfill({ json: list([]) }));
  await page.goto('/fuel-tables');
  await page.getByRole('button', { name: 'Aide sur cette page' }).click();
  const help = page.getByRole('dialog', { name: /Aide/ });
  await expect(help).toContainText('Elle ne représente pas des achats de carburant');
  await expect(help).toContainText('Tarif → table de carburant → coût estimé');
  await help.getByRole('button', { name: 'Relancer le guide du module' }).click();
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Étape 1 sur 5');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Étape 2 sur 5');
});

test('appearance legacy link redirects to the single personalization screen', async ({ page }) => {
  await session(page);
  await page.goto('/settings/appearance');
  await expect(page).toHaveURL(/\/personalize$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Personnal');
});

test('logo can be uploaded from a local file and existing branding is loaded', async ({ page }) => {
  await session(page);
  let uploaded = false;
  await page.route('**/api/v1/transportation/customers**', (r) => r.fulfill({ json: list([]) }));
  await page.route('**/api/v1/customer-portal/branding', (r) =>
    r.fulfill({ json: { accentColor: '#123456' } }),
  );
  await page.route('**/api/v1/customer-portal/branding/logo', (r) => {
    uploaded = true;
    return r.fulfill({ json: { logoUrl: '/test-logo.png', accentColor: '#123456' } });
  });
  await page.goto('/customers');
  await page.getByLabel('Importer depuis l’ordinateur').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  await expect(page.getByAltText('Logo du portail client')).toHaveAttribute(
    'src',
    '/test-logo.png',
  );
  expect(uploaded).toBe(true);
});

test('manufacturing creates an item inline without leaving its BOM', async ({ page }) => {
  await session(page);
  await page.route('**/api/v1/manufacturing/boms**', (r) => r.fulfill({ json: list([]) }));
  await page.route('**/api/v1/wms/choices/items**', (r) => r.fulfill({ json: list([]) }));
  await page.route('**/api/v1/wms/items', (r) =>
    r.fulfill({ json: { id: 'item-1', ...r.request().postDataJSON() } }),
  );
  await page.goto('/manufacturing/boms');
  await page
    .getByRole('button', { name: /Nouvelle nomenclature/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^Produit :/ }).click();
  await page.getByRole('button', { name: '+ Créer un article' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvel article d’inventaire' });
  await dialog.getByLabel('SKU', { exact: true }).fill('PROD-TEST');
  await dialog.getByLabel('Nom', { exact: true }).fill('Pièce de test');
  await dialog.getByRole('button', { name: 'Créer l’article' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: /^Produit : PROD-TEST/ })).toBeVisible();
  await expect(page).toHaveURL(/\/manufacturing\/boms$/);
});

test('failed master-data reads cannot overwrite a record with blank fields', async ({ page }) => {
  await session(page);
  await page.route('**/api/v1/transportation/customers**', (r) =>
    new URL(r.request().url()).pathname.endsWith('/c1')
      ? r.fulfill({ status: 503, json: { message: 'Service indisponible' } })
      : r.fulfill({ json: list([customer]) }),
  );
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifier le client' });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Réessayer le chargement' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Enregistrer', exact: true })).toHaveCount(0);
});

test('location form suggests existing cities and limits postal input', async ({ page }) => {
  await session(page);
  await page.route('**/api/v1/locations**', (r) =>
    r.fulfill({
      json: list(
        new URL(r.request().url()).searchParams.get('search')
          ? [{ city: 'Kingston', state: 'ON', country: 'CA' }]
          : [],
      ),
    }),
  );
  await page.goto('/locations');
  await page.getByRole('button', { name: 'Nouveau lieu', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau lieu' });
  await dialog.getByLabel('Ville', { exact: true }).fill('K');
  await expect(dialog.locator('datalist option[value="Kingston"]')).toHaveCount(1);
  await expect(dialog.getByLabel('Code postal', { exact: true })).toHaveAttribute('maxlength', '7');
  await dialog.getByLabel('Code', { exact: true }).fill('LOC-TEST');
  await dialog.getByLabel('Nom', { exact: true }).fill('Lieu test');
  await dialog.getByLabel('Adresse', { exact: true }).fill('123 rue test');
  await dialog.getByLabel('Code postal', { exact: true }).fill('1234567');
  await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
  await expect(dialog).toContainText('Code postal invalide');
});

test('bin zone edit carries its version and cannot change warehouse', async ({ page }) => {
  await session(page);
  let body: Record<string, unknown> = {};
  const bin = {
    id: 'bin-1',
    code: 'A-01',
    zone: null,
    kind: 'STORAGE',
    locationId: 'site-1',
    isActive: true,
    updatedAt: '2026-09-21T12:00:00.000Z',
    location: { id: 'site-1', code: 'WH-1', name: 'Entrepôt test' },
  };
  await page.route('**/api/v1/wms/sites**', (r) =>
    r.fulfill({ json: list([{ ...bin.location, type: 'WAREHOUSE' }]) }),
  );
  await page.route('**/api/v1/wms/bins**', (r) => {
    if (r.request().method() === 'PATCH') {
      body = r.request().postDataJSON();
      return r.fulfill({ json: { ...bin, ...body } });
    }
    return r.fulfill({ json: [{ ...bin, ...body }] });
  });
  await page.goto('/wms/bins');
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: "Modifier l'emplacement" });
  await expect(dialog.getByRole('button', { name: /^Entrepôt :/ })).toBeDisabled();
  await dialog.getByLabel('Zone', { exact: true }).fill('Produits finis');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(body).toMatchObject({
    zone: 'Produits finis',
    locationId: 'site-1',
    expectedUpdatedAt: bin.updatedAt,
  });
});

test('map is sized after becoming visible and remains usable after resize', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/public/tracking/map-test', (route) =>
    route.fulfill({
      json: {
        shipper: 'Test',
        shipmentNumber: 'SH-TEST',
        status: 'IN_TRANSIT',
        origin: { city: 'Montréal', state: 'QC', latitude: 45.5, longitude: -73.56 },
        destination: { city: 'Québec', state: 'QC', latitude: 46.81, longitude: -71.21 },
        lastPosition: null,
        events: [],
        proofOfDelivery: null,
      },
    }),
  );
  // Deterministic tiles; no public tile server dependency in CI.
  await page.route('https://tile.openstreetmap.org/**', (r) =>
    r.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.goto('/track/map-test');
  const map = page.locator('.leaflet-container');
  await expect(map).toBeVisible();
  await expect(map.locator('path.leaflet-interactive')).toHaveCount(2);
  await expect.poll(() => map.locator('img.leaflet-tile-loaded').count()).toBeGreaterThan(0);
  const within = () =>
    map.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll('path.leaflet-interactive')].every((p) => {
        const point = p.getBoundingClientRect();
        return (
          point.x >= box.x &&
          point.y >= box.y &&
          point.right <= box.right &&
          point.bottom <= box.bottom
        );
      });
    });
  await expect.poll(within).toBe(true);
  await page.setViewportSize({ width: 760, height: 900 });
  await expect.poll(within).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('map-resized.png') });
});
