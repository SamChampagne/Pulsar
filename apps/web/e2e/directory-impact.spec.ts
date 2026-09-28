import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.DIRECTORY_IMPACT_TENANT;
test.skip(!tenant, 'Run directory-impact HTTP fixtures on the isolated database first.');
test.use({ reducedMotion: 'reduce' });
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});

test('Directory impact: stale draft, protected history, retry, deep link and mobile', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const session = await page.request.post('/api/v1/auth/login', { data: credentials() });
  expect(session.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const call = async (method: 'get' | 'post' | 'patch', path: string, data?: unknown) => {
    const r = await page.request[method](`/api/v1${path}`, { headers, ...(data ? { data } : {}) });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const supplier = await call('post', '/purchasing/data/suppliers', {
    code: `DIR-${Date.now()}`,
    name: 'Atelier du Fleuve',
  });
  const item = await call('post', '/purchasing/data/items', {
    code: crypto.randomUUID(),
    name: 'Pièces usinées',
    kind: 'GOODS',
    unit: 'EA',
  });
  const path = `/purchasing/data/suppliers/${supplier.id}/directory`;
  const data = {
    kind: 'ADDRESS',
    label: 'Bureau des commandes',
    role: 'Achats',
    active: true,
    validFrom: null,
    validUntil: null,
    email: '',
    phone: '',
    notes: '',
    address: {
      line1: '42 rue du Parc',
      line2: '',
      city: 'Québec',
      region: 'QC',
      countryCode: 'CA',
      postalCode: 'G1K 3X2',
    },
  };
  const entry = await call('post', path, {
    operationKey: crypto.randomUUID(),
    reason: 'Adresse revue',
    entry: data,
  });
  const orders = [];
  for (let i = 0; i < 2; i++) {
    let order = await call('post', '/purchasing/orders', {
      supplierId: supplier.id,
      currency: 'CAD',
      lines: [{ catalogItemId: item.id, quantity: 3, unitPrice: 15.87 }],
    });
    const selected = await call('patch', `/purchasing/orders/${order.id}/coordinates`, {
      expectedUpdatedAt: order.updatedAt,
      reason: 'Accord revu',
      selections: {
        billingAddress: { id: entry.id, version: 1 },
        deliveryAddress: null,
        contact: null,
      },
    });
    if (i === 1)
      order = await call('post', `/purchasing/orders/${order.id}/transition`, {
        expectedUpdatedAt: selected.updatedAt,
        status: 'CONFIRMED',
      });
    orders.push(order);
  }
  await call('patch', `${path}/${entry.id}`, {
    operationKey: crypto.randomUUID(),
    reason: 'Nouveau bureau',
    expectedVersion: 1,
    entry: { ...data, label: 'Bureau des commandes à jour' },
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials());
  await page.goto(`/purchasing?orderId=${orders[0].id}`);
  await page.getByRole('button', { name: 'Carnet du fournisseur', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: `Carnet · ${supplier.name}`, exact: true });
  let fail = true;
  await page.route(`**/api/v1${path}/${entry.id}/impact*`, async (route) => {
    expect(route.request().method()).toBe('GET');
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        json: { message: 'Lecture temporairement indisponible' },
      });
    } else await route.continue();
  });
  await drawer
    .getByRole('button', { name: 'Documents utilisant Bureau des commandes à jour', exact: true })
    .click();
  const impact = drawer.getByRole('region', {
    name: 'Documents utilisant cette entrée',
    exact: true,
  });
  await expect(impact.getByRole('alert')).toContainText('Lecture temporairement indisponible');
  await impact.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await impact
    .getByRole('combobox', { name: 'Type de document', exact: true })
    .selectOption('supplier-order');
  await expect(impact).toContainText('À revoir');
  await expect(impact).toContainText('version actuelle 2');
  await expect(impact).toContainText('version choisie 1');
  await expect(impact).toContainText('1 documents accessibles');
  const popupPromise = page.waitForEvent('popup');
  await impact
    .getByRole('link', { name: `Ouvrir ${orders[0].number} dans un nouvel onglet`, exact: true })
    .click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(new RegExp(`orderId=${orders[0].id}`));
  await expect(popup.getByRole('dialog', { name: orders[0].number, exact: true })).toBeVisible();
  await popup.close();
  await page.screenshot({
    path: testInfo.outputPath('directory-impact-desktop.png'),
    fullPage: true,
  });
  await impact.getByRole('combobox', { name: 'Périmètre', exact: true }).selectOption('FROZEN');
  await expect(impact).toContainText('Copie conservée');
  await expect(impact).toContainText(orders[1].number);
  await expect(impact.getByText('À revoir', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await impact.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('directory-impact-mobile.png'),
    fullPage: true,
  });
  expect(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('Directory-only reader sees no cross-module counts or links', async ({ page }) => {
  await login(page, credentials('directory'));
  await page.goto('/clients');
  await page
    .getByRole('button', { name: /^Carnet de / })
    .first()
    .click();
  await page
    .getByRole('button', { name: /^Documents utilisant / })
    .first()
    .click();
  const impact = page.getByRole('region', {
    name: 'Documents utilisant cette entrée',
    exact: true,
  });
  await expect(
    impact.getByText('Aucun type de document accessible', { exact: true }),
  ).toBeVisible();
  await expect(impact.getByRole('link')).toHaveCount(0);
  await expect(impact).toContainText('0 documents accessibles');
});

test('Services impact destination opens the exact quote directly', async ({ page }) => {
  const session = await page.request.post('/api/v1/auth/login', { data: credentials() });
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const response = await page.request.get('/api/v1/services/quotes', { headers });
  expect(response.ok()).toBeTruthy();
  const quote = (await response.json()).items[0];
  await login(page, credentials());
  await page.goto(`/services/quotes?quoteId=${quote.id}`);
  await expect(page.getByRole('dialog', { name: quote.number, exact: true })).toBeVisible();
});
