import { test, expect, type Page } from './fixtures';
import { login } from './helpers';

/**
 * Coverage for the new `EntityPicker`/`ReferenceSelect` components (arc 3, task
 * A5). Login is real (see helpers.ts); every endpoint the picker under test
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

async function setAuthOverrides(
  page: Page,
  permissions: string[],
  enabledModules: string[],
): Promise<void> {
  await page.evaluate(
    ({ permissions, enabledModules }) => {
      const s = JSON.parse(localStorage.getItem('pulsar.auth')!);
      s.user.permissions = permissions;
      s.tenant.enabledModules = enabledModules;
      localStorage.setItem('pulsar.auth', JSON.stringify(s));
    },
    { permissions, enabledModules },
  );
}

test('transport order form: the Client picker searches, keyboard-navigates and picks a value', async ({
  page,
}) => {
  await login(page);

  const customers = [
    { id: 'cust-boreal', name: 'Transport Boréal', code: 'BOREAL' },
    { id: 'cust-laurentien', name: 'Transport Laurentien', code: 'LAUR' },
  ];

  await page.route('**/api/v1/transportation/transport-orders**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 25 } });
  });
  await page.route('**/api/v1/transportation/custom-fields**', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/api/v1/transportation/customers**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const items = customers.filter((c) => c.name.toLowerCase().includes(search));
    return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 20 } });
  });

  await page.goto('/transport-orders');
  await page.getByRole('button', { name: 'Nouvelle commande' }).click();
  await expect(page.getByRole('dialog', { name: 'Nouvelle commande de transport' })).toBeVisible();

  // Open the picker (the trigger button's accessible name carries the current value).
  await page.getByRole('button', { name: /^Client :/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Client' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(2);

  // Type to search.
  await dialog.getByRole('textbox', { name: /Rechercher/ }).fill('Transport');
  await expect(dialog.getByRole('option')).toHaveCount(2);

  // Keyboard nav: ↓ ↑ ↓ then Enter lands on the second row (Transport Laurentien).
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Client : Transport Laurentien' })).toBeVisible();
});

test('WMS receiving: the Entrepôt picker create-shortcut is gated on core.locations.manage', async ({
  page,
}) => {
  await login(page);

  const site = { id: 'wh-1', code: 'LAV', name: 'Centre Laval', type: 'WAREHOUSE' };
  await page.route('**/api/v1/wms/receipts**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/v1/wms/sites**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [site], total: 1, page: 1, pageSize: 100 } });
  });
  await page.route('**/api/v1/wms/custom-fields**', (route) => route.fulfill({ json: [] }));

  // With the permission: the shortcut is offered.
  await setAuthOverrides(page, ['wms.read', 'wms.manage', 'core.locations.manage'], ['wms']);
  await page.goto('/wms/receiving');
  await page.getByRole('button', { name: 'Nouvelle réception' }).click();
  await page.getByRole('button', { name: /^Entrepôt :/ }).click();
  const withPerm = page.getByRole('dialog', { name: 'Entrepôt' });
  await expect(withPerm.getByRole('option', { name: /Centre Laval/ })).toBeVisible();
  await expect(withPerm.getByRole('button', { name: 'Créer un entrepôt' })).toBeVisible();

  // Without it: the picker still works, but no shortcut is offered.
  await setAuthOverrides(page, ['wms.read', 'wms.manage'], ['wms']);
  await page.goto('/wms/receiving');
  await page.getByRole('button', { name: 'Nouvelle réception' }).click();
  await page.getByRole('button', { name: /^Entrepôt :/ }).click();
  const withoutPerm = page.getByRole('dialog', { name: 'Entrepôt' });
  await expect(withoutPerm.getByRole('option', { name: /Centre Laval/ })).toBeVisible();
  await expect(withoutPerm.getByRole('button', { name: 'Créer un entrepôt' })).toHaveCount(0);
});

test('/locations: choosing Canada as country offers QC and ON as province choices', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/v1/locations**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 25 } });
  });

  await page.goto('/locations');
  // The empty state (no seeded locations here) repeats the same-labelled
  // button, so scope to the page header's action.
  await page.getByRole('button', { name: 'Nouveau lieu' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau lieu' });

  // Canada is now the explicit creation default. Countries without a region
  // catalog still fall back to free text rather than inventing province choices.
  const country = dialog.getByRole('combobox', { name: 'Pays' });
  await expect(country).toHaveValue('CA');
  await country.selectOption('FR');
  await expect(dialog.getByRole('combobox', { name: 'Province' })).toHaveCount(0);

  await country.selectOption('CA');

  const province = dialog.getByRole('combobox', { name: 'Province' });
  await expect(province.locator('option', { hasText: 'Québec' })).toHaveCount(1);
  await expect(province.locator('option', { hasText: 'Ontario' })).toHaveCount(1);
  await province.selectOption('QC');
  await expect(province).toHaveValue('QC');
});

test('ReferenceSelect keeps an unknown stored value visible instead of blanking it', async ({
  page,
}) => {
  await login(page);
  const legacy = {
    id: 'loc-legacy',
    code: 'LEG-01',
    name: 'Site historique',
    type: 'OTHER',
    customerId: null,
    addressLine1: '1 rue Ancienne',
    addressLine2: null,
    city: 'Testville',
    state: null,
    postalCode: null,
    country: 'XX',
    latitude: null,
    longitude: null,
    timezone: null,
    isActive: true,
  };
  await page.route('**/api/v1/locations**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [legacy], total: 1, page: 1, pageSize: 25 } });
  });

  await page.goto('/locations');
  await page.getByRole('cell', { name: 'LEG-01' }).click();
  const dialog = page.getByRole('dialog', { name: 'Éditer LEG-01' });
  await expect(dialog).toBeVisible();

  // 'XX' is not in the COUNTRIES catalog — the legacy value is still shown,
  // never silently blanked (ReferenceSelect appends it as its own option).
  const country = dialog.getByRole('combobox', { name: 'Pays' });
  await expect(country).toHaveValue('XX');
  await expect(country.locator('option', { hasText: 'XX' })).toHaveCount(1);
});
