import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.SERVICES_LOTS_TENANT;
test.skip(!tenant, 'Run isolated wms-lots HTTP fixtures first (Services + WMS only).');
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
  const call = async (method: 'get' | 'post' | 'patch', path: string, data?: object) => {
    const r = await page.request[method](`/api/v1${path}`, { headers, ...(data ? { data } : {}) });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const code = `I2c-${crypto.randomUUID().slice(0, 8)}`;
  const product = await call('post', '/services/data/items', {
    code,
    name: `${code} Pièce`,
    kind: 'GOODS',
    unit: 'EA',
  });
  const item = await call('post', '/wms/items', {
    sku: code,
    name: `${code} Stock`,
    unit: 'EA',
    lotTracked: true,
  });
  const site = await call('post', '/locations', {
    code,
    name: `${code} Atelier`,
    type: 'WAREHOUSE',
    addressLine1: '1 Test',
    city: 'Québec',
  });
  const bin = await call('post', '/wms/bins', { locationId: site.id, code: 'SERVICE-A' });
  const binB = await call('post', '/wms/bins', { locationId: site.id, code: 'SERVICE-B' });
  const lot = await call('post', `/wms/items/${item.id}/lots`, {
    code: 'SERVICE-LOT-01',
    supplierLot: 'SUPPLIER-013',
    manufacturedOn: '2026-09-01',
    expiresOn: '2027-09-01',
  });
  for (const b of [bin, binB])
    await call('post', '/wms/inventory/adjust', {
      itemId: item.id,
      binId: b.id,
      lotId: lot.id,
      qtyDelta: 5,
    });
  await call('patch', `/services/items/${product.id}/stock-link`, {
    wmsItemId: item.id,
    expectedUpdatedAt: product.updatedAt,
  });
  const partner = await call('post', '/services/data/customers', { code, name: `${code} Client` });
  let project = await call('post', '/services/projects', {
    title: `${code} Projet`,
    partnerId: partner.id,
  });
  project = await call('post', `/services/projects/${project.id}/transition`, {
    status: 'ACTIVE',
    expectedUpdatedAt: project.updatedAt,
  });
  let job = await call('post', '/services/jobs', {
    title: `${code} Intervention`,
    projectId: project.id,
  });
  job = await call('post', `/services/jobs/${job.id}/transition`, {
    status: 'IN_PROGRESS',
    expectedUpdatedAt: job.updatedAt,
  });
  return { call, code, product, item, site, bin, binB, lot, job };
}
async function choose(page: any, label: string, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${label} :`) }).click();
  const picker = page.getByRole('dialog', { name: label, exact: true });
  await picker.getByRole('textbox').fill(name);
  await picker.getByRole('option').filter({ hasText: name }).click();
  await expect(picker).toHaveCount(0);
}
test('Services tutorial explains lot returns and appears only on first entry per user', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const f = await fixture(page);
  const roles = await f.call('get', '/roles');
  const role = (Array.isArray(roles) ? roles : roles.items).find((r: any) => r.key === 'manager');
  const user = {
    tenant: tenant!,
    email: `lot-guide-${crypto.randomUUID()}@example.test`,
    password: 'Test1234!',
  };
  await f.call('post', '/users', {
    email: user.email,
    password: user.password,
    firstName: 'Guide',
    lastName: 'Services',
    roleIds: [role.id],
  });
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByLabel('Tenant (optional)').fill(user.tenant);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  // Close the separate first-entry dashboard guide if offered.
  const tour = page.getByTestId('module-tour');
  if (await tour.isVisible())
    await tour.getByRole('button', { name: 'Passer le tutoriel' }).click();
  await page.goto('/services/interventions');
  await expect(tour).toContainText('Étape 1 sur 7');
  for (let i = 0; i < 4; i++)
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Sortir et retourner les bonnes pièces');
  await expect(tour).toContainText('même lot et emplacement');
  await expect(tour).toContainText('avoir validé');
  await page.setViewportSize({ width: 390, height: 844 });
  await tour.screenshot({ path: info.outputPath('services-lot-tutorial-mobile.png') });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Interventions', exact: true })).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.goto('/services');
  await expect(page.getByRole('heading', { name: 'Projets', exact: true })).toBeVisible();
  await expect(tour).toHaveCount(0);
});
test('Services-only tenant: lot selection, uncertain retry, original lot return, read-only and mobile', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(page),
    errors: string[] = [],
    requests: object[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials());
  const url = `/services/interventions?jobId=${f.job.id}&section=parts`;
  await page.goto(url);
  await page.getByRole('button', { name: 'Consommer une pièce', exact: true }).click();
  await choose(page, 'Produit du Catalogue', f.product.name);
  await choose(page, 'Emplacement source', 'SERVICE-A');
  await page.getByLabel('Quantité consommée').fill('2');
  await page.getByLabel('Utilisation des pièces').fill('Installation du lot identifié');
  const confirm = page.getByRole('checkbox', {
    name: 'Je confirme le mouvement physique et la quantité.',
  });
  const submit = page.getByRole('button', { name: 'Confirmer la sortie de stock' });
  await confirm.check();
  await expect(submit).toBeDisabled();
  await choose(page, 'Lot de stock', f.lot.code);
  await expect(confirm).not.toBeChecked();
  await expect(page.getByText(/Stock de ce lot dans l’emplacement/)).toContainText('5 EA');
  await confirm.check();
  await choose(page, 'Emplacement source', 'SERVICE-B');
  await expect(submit).toBeDisabled();
  await expect(confirm).not.toBeChecked();
  await choose(page, 'Emplacement source', 'SERVICE-A');
  await choose(page, 'Lot de stock', f.lot.code);
  await confirm.check();
  await page.screenshot({ path: info.outputPath('service-lot-selection-desktop.png') });
  const endpoint = `**/api/v1/services/jobs/${f.job.id}/parts`;
  await page.route(endpoint, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      const r = await route.fetch();
      expect(r.ok()).toBeTruthy();
      return route.fulfill({ status: 503, json: { message: 'Réponse perdue après écriture' } });
    }
    if (requests.length === 2)
      return route.fulfill({ status: 403, json: { message: 'Reprise temporairement refusée' } });
    return route.continue();
  });
  await submit.click();
  const retry = page.getByRole('button', { name: 'Vérifier / reprendre l’opération' });
  await expect(retry).toBeVisible();
  await page.reload();
  await retry.click();
  await expect(page.getByText('Reprise temporairement refusée', { exact: true })).toBeVisible();
  await expect(retry).toBeEnabled();
  await page.reload();
  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(requests).toHaveLength(3);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ lotId: f.lot.id, quantity: 2, binId: f.bin.id });
  const card = page.getByRole('article', { name: `Pièce ${f.code}` });
  await expect(card).toContainText(f.lot.code);
  await expect(card).toContainText('SUPPLIER-013');
  const readParts = () => f.call('get', `/services/jobs/${f.job.id}/parts`);
  const parts = (await readParts()).items;
  expect(parts).toHaveLength(1);
  const link = await f.call('get', `/services/items/${f.product.id}/stock-link`);
  await f.call('patch', `/services/items/${f.product.id}/stock-link`, {
    wmsItemId: null,
    expectedUpdatedAt: link.updatedAt,
  });
  await page.getByRole('button', { name: 'Retourner une quantité' }).click();
  await expect(page.getByText(`Retour au lot ${f.lot.code}`, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Lot de stock :/ })).toHaveCount(0);
  await page.getByLabel('Quantité retournée (EA)').fill('0.625');
  await page.getByLabel('Motif du retour').fill('Pièces intactes revenues au lot d’origine');
  await confirm.check();
  const returns: object[] = [];
  await page.route(`**/api/v1/services/jobs/${f.job.id}/parts/*/return`, async (route) => {
    returns.push(route.request().postDataJSON());
    if (returns.length > 1) return route.continue();
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    return route.fulfill({ status: 503, json: { message: 'Réponse retour perdue' } });
  });
  await page.getByRole('button', { name: 'Confirmer le retour de stock' }).click();
  await expect(retry).toBeVisible();
  await page.reload();
  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(returns[0]).not.toHaveProperty('lotId');
  expect(returns[1]).toEqual(returns[0]);
  const updated = (await readParts()).items[0];
  expect(updated.returnCount).toBe(1);
  expect(updated.remainingQuantity).toBe('1.375');
  const actualLot = await f.call('get', `/wms/items/${f.item.id}/lots/${f.lot.id}`);
  expect(actualLot.balances.find((b: any) => b.binId === f.bin.id).qtyOnHand).toBe('3.625');
  await expect(card).toContainText('Retour partiel');
  await card.screenshot({ path: info.outputPath('service-lot-return-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await card.screenshot({ path: info.outputPath('service-lot-return-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, credentials('service-reader'));
  await page.goto(url);
  await expect(card).toContainText(f.lot.code);
  await expect(page.getByRole('button', { name: 'Retourner une quantité' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Consommer une pièce' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
