import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.CATALOG_PACKAGING_TENANT;
test.skip(!tenant, 'Run catalog-packaging HTTP fixtures on the isolated database first.');
test.use({ reducedMotion: 'reduce' });
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
async function fixture(page: any) {
  const session = await page.request.post('/api/v1/auth/login', { data: credentials() });
  expect(session.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const call = async (method: 'get' | 'post' | 'patch', path: string, data?: unknown) => {
    const r = await page.request[method](`/api/v1${path}`, { headers, ...(data ? { data } : {}) });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const name = `Joint colis UI ${Date.now()}`;
  const item = await call('post', '/purchasing/data/items', {
    code: crypto.randomUUID(),
    name,
    kind: 'GOODS',
    unit: 'EA',
  });
  const supplier = await call('post', '/purchasing/data/suppliers', {
    code: crypto.randomUUID(),
    name: `Fournisseur ${name}`,
  });
  return { item, supplier, call };
}
test('Package record: explicit content, immutable fields, lost reply reread and mobile', async ({
  page,
}, testInfo) => {
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials());
  await page.goto('/catalog');
  await page.getByLabel('Rechercher dans le catalogue').fill(f.item.name);
  await page.getByRole('button', { name: `Fiche article ${f.item.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Fiche article — ${f.item.name}`, exact: true });
  await dialog.getByRole('button', { name: 'Conditionnements', exact: true }).click();
  await dialog.getByRole('button', { name: 'Ajouter un conditionnement', exact: true }).click();
  await dialog.getByLabel('Code du conditionnement', { exact: true }).fill('BOX12');
  await dialog.getByLabel('Libellé du conditionnement', { exact: true }).fill('Carton de 12');
  await dialog.getByLabel('Unités par conditionnement', { exact: true }).fill('12');
  await dialog
    .getByLabel('Code-barres du conditionnement', { exact: true })
    .fill(`00Ab-${crypto.randomUUID()}`);
  let writes = 0;
  await page.route(`**/api/v1/catalog/items/${f.item.id}/packages`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++;
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    await route.fulfill({ status: 503, json: { message: 'Réponse simulée perdue' } });
  });
  await dialog.getByRole('button', { name: 'Enregistrer le conditionnement', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Enregistrer le conditionnement', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Relire les conditionnements', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'BOX12 · Carton de 12', exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('packages-desktop.png') });
  await dialog
    .getByRole('button', { name: 'Modifier le conditionnement BOX12', exact: true })
    .click();
  await expect(dialog.getByLabel('Unités par conditionnement', { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Code-barres du conditionnement', { exact: true })).toBeDisabled();
  await dialog.getByLabel('Libellé du conditionnement', { exact: true }).fill('Boîte de 12');
  await dialog.getByRole('button', { name: 'Enregistrer le conditionnement', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'BOX12 · Boîte de 12', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('packages-mobile.png') });
  expect(errors).toEqual([]);
});
test('Packaged purchase to scanned partial receipt: base price, explicit count and exact lost-response replay', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const pack = await f.call('post', `/purchasing/data/items/${f.item.id}/packages`, {
    code: 'BOX12',
    label: 'Carton de 12',
    unitsPerPackage: '12',
    wholeOnly: true,
    barcode: `00UI-${crypto.randomUUID()}`,
  });
  const stock = await f.call('post', '/wms/items', {
    sku: crypto.randomUUID(),
    name: f.item.name,
    unit: 'EA',
  });
  const site = await f.call('post', '/locations', {
    code: crypto.randomUUID(),
    name: `Site ${f.item.name}`,
    type: 'WAREHOUSE',
    addressLine1: '1 Test',
    city: 'Québec',
  });
  const bin = await f.call('post', '/wms/bins', { locationId: site.id, code: 'A-12' });
  await f.call('patch', `/purchasing/items/${f.item.id}/stock-link`, {
    wmsItemId: stock.id,
    expectedUpdatedAt: f.item.updatedAt,
  });
  const order = await f.call('post', '/purchasing/orders', {
    supplierId: f.supplier.id,
    currency: 'CAD',
    lines: [{ catalogItemId: f.item.id, quantity: 1, unitPrice: 2 }],
  });
  await login(page, credentials());
  await page.goto(`/purchasing?orderId=${order.id}`);
  const drawer = page.getByRole('dialog', { name: order.number, exact: true });
  await drawer.getByLabel('Conditionnement à commander', { exact: true }).selectOption(pack.id);
  await drawer.getByLabel('Nombre de conditionnements', { exact: true }).fill('2');
  await drawer.getByRole('button', { name: 'Appliquer le conditionnement', exact: true }).click();
  await expect(drawer.getByLabel('Quantité 1', { exact: true })).toHaveValue('24');
  await expect(drawer.getByLabel('Quantité 1', { exact: true })).toBeDisabled();
  await expect(drawer.getByText('2 × Carton de 12 = 24 EA', { exact: true })).toBeVisible();
  await expect(drawer.getByLabel('Prix unitaire 1', { exact: true })).toHaveValue('2');
  await f.call('patch', `/purchasing/data/items/${f.item.id}/packages/${pack.id}`, {
    expectedVersion: pack.version,
    label: pack.label,
    active: true,
  });
  await drawer.getByRole('button', { name: 'Relire les formats disponibles', exact: true }).click();
  await drawer.getByLabel('Conditionnement à commander', { exact: true }).selectOption(pack.id);
  await drawer.getByRole('button', { name: 'Appliquer le conditionnement', exact: true }).click();
  await drawer.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }).click();
  await drawer.getByRole('button', { name: 'Confirmer la commande', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer l’action fournisseur', exact: true })
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  await expect(
    drawer.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }),
  ).toHaveCount(0);
  const saved = await f.call('get', `/purchasing/orders/${order.id}`);
  expect(saved.total).toBe('48.00');
  expect(saved.lines[0].packageSnapshot.baseQuantity).toBe('24');
  expect(saved.lines[0].packageSnapshot.version).toBe(2);
  await page.goto(`/purchasing/orders/${order.id}/receiving`);
  const scan = page.getByLabel('Scanner le conditionnement de cet arrivage', { exact: true });
  await scan.fill(pack.barcode);
  await scan.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Conditionnement reconnu' }),
  ).toBeVisible();
  const count = page.getByLabel(`Nombre de conditionnements reçus pour ${f.item.name}`, {
    exact: true,
  });
  await expect(count).toHaveValue('');
  await expect(
    page.getByRole('button', { name: 'Confirmer la réception physique', exact: true }),
  ).toBeDisabled();
  expect((await f.call('get', `/purchasing/orders/${order.id}/receipts`)).total).toBe(0);
  await count.fill('0.5');
  await expect(page.getByRole('alert')).toContainText('nombre entier');
  await count.fill('1');
  await page.getByRole('button', { name: /^Entrepôt de réception :/ }).click();
  const sites = page.getByRole('dialog', { name: 'Entrepôt de réception', exact: true });
  await sites.getByRole('textbox').fill(site.name);
  await sites.getByRole('option', { name: site.name, exact: true }).click();
  await page.getByLabel('Bon de livraison ou référence', { exact: true }).fill('BL-PACK-UI');
  await page
    .getByRole('button', { name: new RegExp(`^Emplacement pour ${f.item.name} :`) })
    .click();
  await page
    .getByRole('dialog', { name: `Emplacement pour ${f.item.name}`, exact: true })
    .getByRole('option', { name: bin.code, exact: true })
    .click();
  await expect(page.getByText('1 × 12 = 12 EA à réceptionner', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /Je confirme l’arrivée physique/ }).check();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('receiving-packages-desktop.png') });
  const bodies: unknown[] = [];
  await page.route(`**/api/v1/purchasing/orders/${order.id}/receipts`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    if (bodies.length === 1)
      return route.fulfill({ status: 503, json: { message: 'Réponse simulée perdue' } });
    await route.fulfill({ response: r });
  });
  await page.getByRole('button', { name: 'Confirmer la réception physique', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Réception à vérifier', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la réception conservée', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Réception enregistrée' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  const history = await f.call('get', `/purchasing/orders/${order.id}/receipts`);
  expect(history.total).toBe(1);
  expect(history.items[0].lines[0].packageCount).toBe('1');
  await expect(page.getByRole('region', { name: 'Historique des arrivages' })).toContainText(
    '1 × Carton de 12',
  );
  expect((await f.call('get', `/purchasing/orders/${order.id}`)).lines[0].remaining).toBe('12');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('region', { name: 'Historique des arrivages' }).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('receiving-packages-mobile.png') });
  expect(errors).toEqual([]);
});
test('Purchasing first visit teaches packaged receiving and reader cannot change formats', async ({
  page,
}) => {
  const f = await fixture(page);
  await login(page, credentials('reader'));
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto('/purchasing');
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Suivre un achat');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Conditionnements');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('2 cartons × 12 EA');
  for (let i = 0; i < 3; i++)
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('le scan ne remplit ni quantité ni stock');
  await tour.getByRole('button', { name: 'Passer le tutoriel', exact: true }).click();
  await page.reload();
  await expect(tour).toHaveCount(0);
  await page.goto('/purchasing/data');
  await page.getByRole('button', { name: 'Articles et prestations', exact: true }).click();
  await page.getByLabel('Rechercher dans les données').fill(f.item.name);
  await page.getByRole('button', { name: `Fiche article ${f.item.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Fiche article — ${f.item.name}`, exact: true });
  await dialog.getByRole('button', { name: 'Conditionnements', exact: true }).click();
  await expect(dialog.getByText('Aucun conditionnement.', { exact: false })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Ajouter un conditionnement', exact: true }),
  ).toHaveCount(0);
});
