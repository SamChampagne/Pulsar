import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.SUPPLIER_COORDINATES_TENANT;
test.skip(!tenant, 'Run supplier-order-coordinates HTTP fixtures on the isolated database first.');
test.use({ reducedMotion: 'reduce' });

test('Purchasing alone: directory, guarded editing, lost replies and frozen mobile copy', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const credentials = { tenant: tenant!, email: `manager@${tenant}.test`, password: 'Test1234!' };
  const session = await page.request.post('/api/v1/auth/login', { data: credentials });
  expect(session.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const call = async (method: 'post' | 'get' | 'patch', path: string, data?: unknown) => {
    const r = await page.request[method](`/api/v1${path}`, { headers, ...(data ? { data } : {}) });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const supplier = await call('post', '/purchasing/data/suppliers', {
    code: crypto.randomUUID(),
    name: `Fournisseur autonome ${Date.now()}`,
  });
  const item = await call('post', '/purchasing/data/items', {
    code: crypto.randomUUID(),
    name: 'Composant achat',
    kind: 'GOODS',
    unit: 'EA',
  });
  const order = await call('post', '/purchasing/orders', {
    supplierId: supplier.id,
    currency: 'CAD',
    lines: [{ catalogItemId: item.id, quantity: 5, unitPrice: 15 }],
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials);
  await page.goto(`/purchasing?orderId=${order.id}`);
  const drawer = page.getByRole('dialog', { name: order.number, exact: true });
  const coordinates = drawer.getByRole('region', { name: 'Coordonnées du document', exact: true });
  await expect(coordinates).toContainText('Aucune coordonnée');
  await drawer.getByRole('button', { name: 'Carnet du fournisseur', exact: true }).click();
  const directory = page.getByRole('dialog', { name: `Carnet · ${supplier.name}`, exact: true });
  await directory.getByRole('button', { name: 'Ajouter une adresse', exact: true }).click();
  await directory.getByLabel('Nom du site / adresse').fill('Bureau des commandes');
  await directory.getByLabel('Rue et numéro').fill('42 rue du Parc');
  await directory.getByLabel('Ville', { exact: true }).fill('Québec');
  await directory.getByLabel('Code postal').fill('G1K 3X2');
  await directory.getByLabel('Motif de la modification').fill('Adresse fournisseur vérifiée');
  await directory.getByRole('button', { name: 'Enregistrer la version', exact: true }).click();
  await expect(
    directory.getByRole('heading', { name: 'Bureau des commandes', exact: true }),
  ).toBeVisible();
  await directory.getByRole('button', { name: 'Fermer', exact: true }).click();
  await expect(directory).toHaveCount(0);
  // The coordinate editor cannot discard unsaved commercial changes.
  await drawer.getByLabel('Quantité 1', { exact: true }).fill('6');
  await expect(
    coordinates.getByRole('button', { name: 'Choisir / revoir les coordonnées', exact: true }),
  ).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }).click();
  await coordinates
    .getByRole('button', { name: 'Choisir / revoir les coordonnées', exact: true })
    .click();
  await expect(drawer.getByLabel('Quantité 1', { exact: true })).toBeDisabled();
  await expect(
    drawer.getByRole('button', { name: 'Carnet du fournisseur', exact: true }),
  ).toBeDisabled();
  const closeButtons = drawer.getByRole('button', { name: 'Fermer', exact: true });
  await expect(closeButtons).toHaveCount(2);
  for (const button of await closeButtons.all()) await expect(button).toBeDisabled();
  await expect(
    drawer.getByRole('button', { name: 'Confirmer la commande', exact: true }),
  ).toBeDisabled();
  await expect(
    coordinates.getByRole('button', { name: 'Adresse de livraison / intervention', exact: true }),
  ).toHaveCount(0);
  await coordinates
    .getByRole('button', { name: 'Choisir Bureau des commandes', exact: true })
    .click();
  await coordinates.getByLabel('Motif du choix / changement').fill('Coordonnées de cet accord');
  let selections = 0;
  await page.route(`**/api/v1/purchasing/orders/${order.id}/coordinates`, async (route) => {
    if (route.request().method() === 'PATCH') {
      selections++;
      const r = await route.fetch();
      expect(r.ok()).toBeTruthy();
      await route.abort();
    } else await route.continue();
  });
  await coordinates
    .getByRole('button', { name: 'Enregistrer les coordonnées', exact: true })
    .click();
  await coordinates
    .getByRole('button', { name: 'Vérifier le document enregistré', exact: true })
    .click();
  await expect(coordinates).toContainText('Sélection enregistrée');
  await expect(coordinates).toContainText('Adresse du fournisseur');
  expect(selections).toBe(1);
  await coordinates.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('supplier-coordinates-desktop.png'),
    fullPage: true,
  });
  let confirmations = 0,
    attempts = 0;
  await page.route(`**/api/v1/purchasing/orders/${order.id}/transition`, async (route) => {
    if (++attempts === 1) {
      await route.fulfill({ status: 503, json: { message: 'Interruption avant traitement' } });
      return;
    }
    confirmations++;
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    await route.abort();
  });
  await drawer.getByRole('button', { name: 'Confirmer la commande', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Confirmer l’action fournisseur', exact: true });
  await modal.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await modal
    .getByRole('button', { name: 'Vérifier la commande enregistrée', exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  // A read with an unchanged parent version must release the controls after a failed request.
  await expect(
    drawer.getByRole('button', { name: 'Confirmer la commande', exact: true }),
  ).toBeEnabled();
  await drawer.getByRole('button', { name: 'Confirmer la commande', exact: true }).click();
  await modal.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await modal
    .getByRole('button', { name: 'Vérifier la commande enregistrée', exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(coordinates).toContainText('Copie figée');
  expect(confirmations).toBe(1);
  await expect(drawer.getByLabel('Quantité 1', { exact: true })).toBeDisabled();
  await call('patch', `/purchasing/data/suppliers/${supplier.id}`, {
    expectedUpdatedAt: supplier.updatedAt,
    name: 'Fournisseur renommé après engagement',
  });
  await page.reload();
  await expect(coordinates).toContainText(supplier.name);
  await expect(
    coordinates.getByRole('button', { name: 'Choisir / revoir les coordonnées', exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await coordinates.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('supplier-coordinates-mobile.png'),
    fullPage: true,
  });
  expect(await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test('Purchasing first-entry tutorial, integrated business rules and read-only access', async ({
  page,
}) => {
  await login(page, { tenant: tenant!, email: `reader@${tenant}.test`, password: 'Test1234!' });
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto('/purchasing');
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Suivre un achat jusqu’à son arrivée');
  for (let i = 0; i < 3; i++)
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Identifier le fournisseur de cet accord');
  await expect(tour).toContainText('pas de votre entrepôt de réception');
  await tour.getByRole('button', { name: 'Passer le tutoriel', exact: true }).click();
  await page.reload();
  await expect(tour).toHaveCount(0);
  await page.goto('/documentation?module=purchasing');
  await expect(
    page.getByText(/Sur un brouillon enregistré, Coordonnées du document capture explicitement/),
  ).toBeVisible();
  await page.goto('/purchasing');
  await page.getByRole('cell', { name: /^PO-/ }).first().click();
  const coordinates = page.getByRole('region', { name: 'Coordonnées du document', exact: true });
  await expect(coordinates).toBeVisible();
  await expect(
    coordinates.getByRole('button', { name: 'Choisir / revoir les coordonnées', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Carnet du fournisseur', exact: true }).click();
  const directory = page.getByRole('dialog', { name: /^Carnet ·/ });
  await expect(directory).toBeVisible();
  await expect(
    directory.getByRole('button', { name: 'Ajouter une adresse', exact: true }),
  ).toHaveCount(0);
});
