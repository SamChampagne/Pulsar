import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.CATALOG_DETAILS_TENANT;
test.skip(!tenant, 'Run catalog-details HTTP fixtures on the isolated database first.');
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
  const call = async (method: 'get' | 'post' | 'put', path: string, data?: unknown) => {
    const r = await page.request[method](`/api/v1${path}`, { headers, ...(data ? { data } : {}) });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const name = `Pompe UI ${Date.now()}`;
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
test('Article details: sections, persisted measurements, lost reply recovery and mobile', async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials());
  await page.goto('/catalog');
  await page.getByLabel('Rechercher dans le catalogue').fill(f.item.name);
  await page.getByRole('button', { name: `Fiche article ${f.item.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Fiche article — ${f.item.name}`, exact: true });
  await dialog.getByLabel('Marque', { exact: true }).fill('Pulsar matériel');
  await dialog.getByLabel('Poids net (kg)', { exact: true }).fill('1.2345');
  await dialog.getByLabel('Consignes de manutention', { exact: true }).fill('Maintenir vertical.');
  let writes = 0;
  await page.route(`**/api/v1/catalog/items/${f.item.id}/details`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes++;
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    await route.fulfill({ status: 503, json: { message: 'Réponse simulée perdue' } });
  });
  await dialog.getByRole('button', { name: 'Enregistrer la fiche article', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Enregistrer la fiche article', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Recharger la fiche article', exact: true }).click();
  await expect(dialog.getByLabel('Poids net (kg)', { exact: true })).toHaveValue('1.2345');
  await expect(dialog.getByLabel('Consignes de manutention', { exact: true })).toHaveValue(
    'Maintenir vertical.',
  );
  expect(writes).toBe(1);
  await dialog.getByLabel('Marque', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('catalog-details-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('catalog-details-mobile.png') });
  expect(errors).toEqual([]);
});
test('Supplier reference: create in Pulsar UI, apply to order, reject wrong multiple, confirm immutable copy', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const f = await fixture(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials());
  await page.goto('/catalog');
  await page.getByLabel('Rechercher dans le catalogue').fill(f.item.name);
  await page.getByRole('button', { name: `Fiche article ${f.item.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Fiche article — ${f.item.name}`, exact: true });
  await dialog.getByRole('button', { name: 'Références fournisseurs', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Ajouter une référence fournisseur', exact: true })
    .click();
  await dialog.getByRole('button', { name: /^Fournisseur de la référence :/ }).click();
  const picker = page.getByRole('dialog', { name: 'Fournisseur de la référence', exact: true });
  await picker.getByRole('textbox').fill(f.supplier.name);
  await picker.getByRole('option', { name: f.supplier.name, exact: true }).click();
  await dialog.getByLabel('Référence chez le fournisseur', { exact: true }).fill('REF-UI-6');
  await dialog.getByLabel('Prix de la référence', { exact: true }).fill('12.3456');
  await dialog.getByLabel('Quantité minimale', { exact: true }).fill('6');
  await dialog.getByLabel('Multiple de commande', { exact: true }).fill('3');
  await dialog
    .getByLabel('Conditionnement fournisseur', { exact: true })
    .fill('Carton de 3, prix par pièce');
  await dialog
    .getByLabel('Conditions et consignes d’achat', { exact: true })
    .fill('Prévenir avant livraison');
  await dialog.getByRole('button', { name: 'Enregistrer la référence', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: `${f.supplier.name} · REF-UI-6`, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('catalog-supplier-reference.png') });
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  const order = await f.call('post', '/purchasing/orders', {
    supplierId: f.supplier.id,
    currency: 'CAD',
    lines: [{ catalogItemId: f.item.id, quantity: 6, unitPrice: 1 }],
  });
  await page.goto(`/purchasing?orderId=${order.id}`);
  const drawer = page.getByRole('dialog', { name: order.number, exact: true });
  await drawer.getByRole('button', { name: 'Appliquer ces conditions', exact: true }).click();
  await expect(drawer.getByLabel('Prix unitaire 1', { exact: true })).toHaveValue('12.3456');
  await expect(drawer.getByLabel('Prix unitaire 1', { exact: true })).toBeDisabled();
  await drawer.getByLabel('Quantité 1', { exact: true }).fill('7');
  await drawer.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('multiple de 3');
  await drawer.getByLabel('Quantité 1', { exact: true }).fill('6');
  await drawer.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Confirmer la commande', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer l’action fournisseur', exact: true })
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  await expect(
    drawer.getByText('Copie historique conservée sur la commande.', { exact: true }),
  ).toBeVisible();
  const saved = await f.call('get', `/purchasing/orders/${order.id}`);
  expect(saved.lines[0].supplierTermsSnapshot.supplierReference).toBe('REF-UI-6');
  expect(saved.total).toBe('74.07');
  await page.setViewportSize({ width: 390, height: 844 });
  await drawer
    .getByText('Copie historique conservée sur la commande.', { exact: true })
    .scrollIntoViewIfNeeded();
  expect(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('purchasing-terms-mobile.png') });
  expect(errors).toEqual([]);
});
test('Purchasing reader: module-specific first visit, technical record without writes', async ({
  page,
}) => {
  const f = await fixture(page);
  await login(page, credentials('reader'));
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto('/purchasing');
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Suivre un achat jusqu’à son arrivée');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Références fournisseurs');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Appliquer ces conditions');
  await tour.getByRole('button', { name: 'Passer le tutoriel', exact: true }).click();
  await page.reload();
  await expect(tour).toHaveCount(0);
  await page.goto('/purchasing/data');
  await page.getByRole('button', { name: 'Articles et prestations', exact: true }).click();
  await page.getByLabel('Rechercher dans les données').fill(f.item.name);
  await page.getByRole('button', { name: `Fiche article ${f.item.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Fiche article — ${f.item.name}`, exact: true });
  await expect(dialog.getByLabel('Marque', { exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Enregistrer la fiche article', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Références fournisseurs', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Ajouter une référence fournisseur', exact: true }),
  ).toHaveCount(0);
});
