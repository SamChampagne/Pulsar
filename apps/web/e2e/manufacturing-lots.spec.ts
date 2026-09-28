import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.MANUFACTURING_LOTS_TENANT;
test.skip(!tenant, 'Run isolated wms-lots HTTP fixtures first.');
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
  const call = async (method: 'get' | 'post', path: string, data?: object) => {
    const r = await page.request[method](`/api/v1${path}`, { headers, ...(data ? { data } : {}) });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const code = `Workshop-${crypto.randomUUID().slice(0, 8)}`;
  const raw = await call('post', '/wms/items', {
    sku: `${code}-RAW`,
    name: 'Acier atelier',
    unit: 'KG',
    lotTracked: true,
  });
  const product = await call('post', '/wms/items', {
    sku: `${code}-FG`,
    name: 'Support assemblé',
    unit: 'EA',
    lotTracked: true,
  });
  const site = await call('post', '/locations', {
    code,
    name: `${code} Site`,
    type: 'WAREHOUSE',
    addressLine1: '1 Test',
    city: 'Québec',
  });
  const bin = await call('post', '/wms/bins', { locationId: site.id, code: 'RAW' });
  const dest = await call('post', '/wms/bins', { locationId: site.id, code: 'FINISHED' });
  const lots = [];
  for (const name of ['SOURCE-A', 'SOURCE-B']) {
    const lot = await call('post', `/wms/items/${raw.id}/lots`, {
      code: name,
      supplierLot: `${name}-SUPPLIER`,
      expiresOn: '2027-09-01',
    });
    await call('post', '/wms/inventory/adjust', {
      itemId: raw.id,
      binId: bin.id,
      lotId: lot.id,
      qtyDelta: 5,
    });
    lots.push(lot);
  }
  const output = await call('post', `/wms/items/${product.id}/lots`, {
    code: 'FINISHED-2026',
    manufacturedOn: '2026-09-25',
  });
  let bom = await call('post', '/manufacturing/boms', {
    code,
    name: 'Assemblage avec lots',
    productRef: product.sku,
  });
  await call('post', `/manufacturing/boms/${bom.id}/lines`, {
    materialRef: raw.sku,
    quantityPerUnit: '1',
    expectedUpdatedAt: bom.updatedAt,
  });
  bom = await call('get', `/manufacturing/boms/${bom.id}`);
  const revision = await call('post', `/manufacturing/boms/${bom.id}/revisions`, {
    expectedUpdatedAt: bom.updatedAt,
    acknowledgeUnits: true,
  });
  let order = await call('post', '/manufacturing/orders', {
    name: code,
    productRef: product.sku,
    quantity: 3,
    dueDate: '2026-10-10T00:00:00Z',
    releaseDate: '2026-09-25T00:00:00Z',
    bomId: bom.id,
  });
  await call('post', `/manufacturing/orders/${order.id}/material-context`, {
    expectedUpdatedAt: order.updatedAt,
    locationId: site.id,
    bomRevisionId: revision.id,
  });
  await call('post', `/manufacturing/orders/${order.id}/release`, {});
  order = await call('post', `/manufacturing/orders/${order.id}/start`, {});
  return { call, raw, product, site, bin, dest, lots, output, order };
}
async function choose(page: any, container: any, name: string) {
  await container.getByRole('button', { name: /^Lot de stock :/ }).click();
  const picker = page.getByRole('dialog', { name: 'Lot de stock', exact: true });
  await picker.getByRole('textbox').fill(name);
  await picker.getByRole('option').filter({ hasText: name }).click();
  await expect(picker).toHaveCount(0);
}

test('Lot trace shows recorded links, direct dossiers, partial scope and read-only mobile states', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await f.call('post', `/manufacturing/shop-floor/orders/${f.order.id}/declarations`, {
    operationKey: crypto.randomUUID(),
    expectedUpdatedAt: f.order.updatedAt,
    goodQuantity: 2,
    scrapQuantity: 0,
    toBinId: f.dest.id,
    outputLotId: f.output.id,
    note: 'Preuve de traçabilité navigateur',
    consumptions: f.lots.map((lot) => ({
      itemId: f.raw.id,
      fromBinId: f.bin.id,
      lotId: lot.id,
      quantity: '1.5',
    })),
  });
  await login(page, credentials());
  await page.goto(`/wms/items/${f.raw.id}/lots?lotId=${f.lots[0].id}`);
  await page.getByRole('link', { name: 'Traçabilité du lot', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Traçabilité du lot', exact: true }),
  ).toBeVisible();
  const graph = page.getByRole('region', { name: 'Parcours des lots' });
  await expect(graph.getByRole('button', { name: /FINISHED-2026/ })).toBeVisible();
  await graph.getByRole('button', { name: /FINISHED-2026/ }).click();
  await expect(page.getByRole('region', { name: 'Dossiers du lot sélectionné' })).toContainText(
    'Dossiers · FINISHED-2026',
  );
  await expect(page.getByRole('region', { name: 'Dossiers du lot sélectionné' })).toContainText(
    'Aucun dossier direct',
  );
  await page.screenshot({ path: info.outputPath('lot-trace-desktop.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Profondeur', exact: true }).selectOption('1');
  await expect(page.getByText('Parcours partiel', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('lot-trace-mobile.png'), fullPage: true });
  const path = `/wms/items/${f.product.id}/lots/${f.output.id}/trace`;
  await page.goto(path);
  await page.getByRole('combobox', { name: 'Sens du parcours', exact: true }).selectOption('upstream');
  await expect(graph.getByRole('button', { name: /SOURCE-A/ })).toBeVisible();
  await expect(graph.getByRole('button', { name: /SOURCE-B/ })).toBeVisible();
  await page.route('**/api/v1/wms/items/*/lots/*/trace?*', (route) =>
    route.fulfill({ status: 503, json: { message: 'Lecture temporairement indisponible' } }),
  );
  await page.getByRole('button', { name: 'Actualiser la lecture' }).click();
  await expect(page.getByRole('alert')).toContainText('Lecture temporairement indisponible');
  await expect(graph).toHaveCount(0);
  await page.unroute('**/api/v1/wms/items/*/lots/*/trace?*');
  await page.getByRole('button', { name: 'Actualiser la lecture' }).click();
  await expect(graph.getByRole('button', { name: /SOURCE-A/ })).toBeVisible();
  await login(page, credentials('reader'));
  await page.goto(path);
  await expect(page.getByText('Parcours atelier indisponible', { exact: false })).toBeVisible();
  await expect(graph.getByRole('button')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Full correction previews physical effects and replays exactly after lost response and refusal', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(page),
    errors: string[] = [],
    requests: any[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const path = `/manufacturing/shop-floor/orders/${f.order.id}`;
  const declaration = await f.call('post', `${path}/declarations`, {
    operationKey: crypto.randomUUID(),
    expectedUpdatedAt: f.order.updatedAt,
    goodQuantity: 2,
    scrapQuantity: 1,
    toBinId: f.dest.id,
    outputLotId: f.output.id,
    note: 'Erreur de relevé à corriger',
    consumptions: f.lots.map((lot) => ({
      itemId: f.raw.id,
      fromBinId: f.bin.id,
      lotId: lot.id,
      quantity: '1.5',
    })),
  });
  await login(page, credentials());
  const url = `/manufacturing/orders/${f.order.id}`;
  await page.goto(url);
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  const section = page.getByRole('region', { name: 'Correction de déclaration' });
  await section.getByLabel('Déclaration à corriger').selectOption(declaration.id);
  await section.getByRole('button', { name: 'Examiner les effets de la correction' }).click();
  await expect(section.getByText('Restituer au stock', { exact: true })).toHaveCount(2);
  await expect(section.getByText('Retirer du stock', { exact: true })).toBeVisible();
  await expect(section).toContainText('SOURCE-A');
  await expect(section).toContainText('FINISHED-2026');
  await expect(
    section.getByRole('button', { name: 'Contrepasser la déclaration', exact: true }),
  ).toBeDisabled();
  await section
    .getByLabel('Motif de correction')
    .fill('Erreur opérateur, situation physique vérifiée');
  await section.getByRole('checkbox').check();
  await section.screenshot({ path: info.outputPath('correction-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await section.screenshot({ path: info.outputPath('correction-mobile.png') });
  let attempts = 0;
  await page.route(`**/api/v1${path}/declarations/${declaration.id}/reverse`, async (route) => {
    requests.push(route.request().postDataJSON());
    attempts++;
    if (attempts === 1) {
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBeTruthy();
      await route.fulfill({ status: 503, json: { message: 'Réponse perdue après commit' } });
    } else if (attempts === 2)
      await route.fulfill({ status: 403, json: { message: 'Refus intermédiaire' } });
    else await route.continue();
  });
  await section.getByRole('button', { name: 'Contrepasser la déclaration', exact: true }).click();
  await expect(section.getByRole('button', { name: 'Reprendre la même correction' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  await section.getByRole('button', { name: 'Reprendre la même correction' }).click();
  await expect(section.getByRole('alert')).toContainText('Refus intermédiaire');
  await page.reload();
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  await section.getByRole('button', { name: 'Reprendre la même correction' }).click();
  await expect(section.getByRole('button', { name: 'Reprendre la même correction' })).toHaveCount(
    0,
  );
  expect(requests).toHaveLength(3);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
  const view = await f.call('get', path);
  expect(view).toMatchObject({ good: 0, scrap: 0, remaining: 3 });
  expect(view.declarations).toHaveLength(1);
  await expect(page.getByLabel('Déclaration contrepassée')).toContainText('Erreur opérateur');
  await page.getByRole('link', { name: 'Voir les mouvements compensatoires →' }).click();
  await expect(page.getByRole('link', { name: `${f.order.number} ↗` })).toHaveCount(3);
  await login(page, credentials('manufacturing-reader'));
  await page.goto(url);
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  await expect(page.getByLabel('Déclaration contrepassée')).toBeVisible();
  await expect(section).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('Correction blocks unavailable output and never sends when browser persistence fails', async ({
  page,
}) => {
  const f = await fixture(page),
    path = `/manufacturing/shop-floor/orders/${f.order.id}`;
  const d = await f.call('post', `${path}/declarations`, {
    operationKey: crypto.randomUUID(),
    expectedUpdatedAt: f.order.updatedAt,
    goodQuantity: 1,
    scrapQuantity: 0,
    toBinId: f.dest.id,
    outputLotId: f.output.id,
    note: 'Erreur à vérifier',
    consumptions: [{ itemId: f.raw.id, fromBinId: f.bin.id, quantity: '0' }],
  });
  const stock = { itemId: f.product.id, binId: f.dest.id, lotId: f.output.id };
  await f.call('post', '/wms/inventory/adjust', { ...stock, qtyDelta: -1 });
  await login(page, credentials());
  await page.goto(`/manufacturing/orders/${f.order.id}`);
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  const section = page.getByRole('region', { name: 'Correction de déclaration' });
  await section.getByLabel('Déclaration à corriger').selectOption(d.id);
  await section.getByRole('button', { name: 'Examiner les effets de la correction' }).click();
  await expect(section.getByRole('alert')).toContainText('n’est plus disponible');
  await expect(
    section.getByRole('button', { name: 'Contrepasser la déclaration', exact: true }),
  ).toHaveCount(0);
  await f.call('post', '/wms/inventory/adjust', { ...stock, qtyDelta: 1 });
  await section.getByRole('button', { name: 'Examiner les effets de la correction' }).click();
  await section.getByLabel('Motif de correction').fill('Erreur de saisie vérifiée');
  await section.getByRole('checkbox').check();
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/reverse')) writes++;
  });
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('pulsar:production-reversal:')) throw new Error('Storage unavailable');
      return original.call(this, key, value);
    };
  });
  await section.getByRole('button', { name: 'Contrepasser la déclaration', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('Aucun mouvement envoyé');
  expect(writes).toBe(0);
  expect((await f.call('get', path)).declarations[0].reversal).toBeNull();
});

test('First manufacturing visit teaches source/output lots once per user', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const f = await fixture(page);
  const roles = await f.call('get', '/roles');
  const role = (Array.isArray(roles) ? roles : roles.items).find((r: any) => r.key === 'manager');
  const user = {
    tenant: tenant!,
    email: `workshop-guide-${crypto.randomUUID()}@example.test`,
    password: 'Test1234!',
  };
  await f.call('post', '/users', {
    email: user.email,
    password: user.password,
    firstName: 'Guide',
    lastName: 'Atelier',
    roleIds: [role.id],
  });
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByLabel('Tenant (optional)').fill(user.tenant);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  const tour = page.getByTestId('module-tour');
  if (await tour.isVisible())
    await tour.getByRole('button', { name: 'Passer le tutoriel' }).click();
  await page.goto(`/manufacturing/orders/${f.order.id}`);
  await expect(tour).toContainText('Étape 1 sur 6');
  for (let i = 0; i < 2; i++)
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Ajouter un lot / emplacement');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Un lot de sortie par déclaration');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('pas sur chaque pièce');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('OF terminé : correction refusée');
  await page.setViewportSize({ width: 390, height: 844 });
  await tour.screenshot({ path: info.outputPath('manufacturing-lots-tutorial-mobile.png') });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Atelier et stock réel' })).toBeVisible();
  await expect(tour).toHaveCount(0);
});
test('Actual multi-lot production: exact lost-response recovery, provenance, journal and mobile', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(page),
    errors: string[] = [],
    requests: any[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials());
  const url = `/manufacturing/orders/${f.order.id}`;
  await page.goto(url);
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  const drawer = page.getByRole('dialog', { name: `${f.order.number} · Atelier` });
  await drawer.getByLabel('Quantité bonne', { exact: true }).fill('2');
  await drawer.getByLabel('Quantité rebutée', { exact: true }).fill('1');
  await drawer.getByLabel('Destination des produits finis').selectOption(f.dest.id);
  await choose(page, drawer.getByRole('region', { name: 'Lot produit' }), f.output.code);
  const fields = drawer.locator('fieldset');
  await fields.first().getByLabel(`Consommation réelle ${f.raw.sku}`).fill('1.625');
  await fields.first().getByLabel(`Emplacement source ${f.raw.sku}`).selectOption(f.bin.id);
  await choose(page, fields.first(), f.lots[0].code);
  await fields.first().getByRole('button', { name: 'Ajouter un lot / emplacement' }).click();
  await fields.nth(1).getByLabel(`Consommation réelle ${f.raw.sku}`).fill('1.375');
  await fields.nth(1).getByLabel(`Emplacement source ${f.raw.sku}`).selectOption(f.bin.id);
  await drawer
    .getByLabel('Note d’atelier / écarts / rebuts')
    .fill('Sources A et B, une pièce rebutée au contrôle');
  const confirm = drawer.getByRole('checkbox', { name: /Je confirme les quantités/ });
  const submit = drawer.getByRole('button', { name: 'Valider la déclaration et le stock' });
  await confirm.check();
  await expect(submit).toBeDisabled();
  await choose(page, fields.nth(1), f.lots[1].code);
  await expect(confirm).not.toBeChecked();
  await confirm.check();
  await page.screenshot({ path: info.outputPath('manufacturing-lots-form.png') });
  await page.route(
    `**/api/v1/manufacturing/shop-floor/orders/${f.order.id}/declarations`,
    async (route) => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) {
        const r = await route.fetch();
        expect(r.ok()).toBeTruthy();
        return route.fulfill({ status: 503, json: { message: 'Réponse perdue après commit' } });
      }
      if (requests.length === 2)
        return route.fulfill({ status: 403, json: { message: 'Reprise temporairement refusée' } });
      return route.continue();
    },
  );
  await submit.click();
  const retry = drawer.getByRole('button', { name: 'Reprendre la même déclaration' });
  await expect(retry).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  await retry.click();
  await expect(drawer.getByRole('alert')).toContainText('Reprise temporairement refusée');
  await page.reload();
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(requests).toHaveLength(3);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
  expect(requests[0].consumptions.map((c: any) => c.lotId)).toEqual(f.lots.map((l) => l.id));
  const trace = drawer.getByRole('region', { name: 'Traçabilité des lots' });
  await expect(trace).toContainText('SOURCE-A');
  await expect(trace).toContainText('SOURCE-B');
  await expect(trace).toContainText('FINISHED-2026');
  const floor = await f.call('get', `/manufacturing/shop-floor/orders/${f.order.id}`);
  expect(floor.declarations).toHaveLength(1);
  expect(floor.remaining).toBe(0);
  expect(floor.declarations[0].evidence.movements).toHaveLength(3);
  const output = await f.call('get', `/wms/items/${f.product.id}/lots/${f.output.id}`);
  expect(output.balances[0].qtyOnHand).toBe('2');
  await trace.screenshot({ path: info.outputPath('manufacturing-genealogy-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await trace.screenshot({ path: info.outputPath('manufacturing-genealogy-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await drawer.getByRole('link', { name: 'Voir les 3 mouvements →' }).click();
  await expect(page.getByRole('link', { name: `${f.order.number} ↗` })).toHaveCount(3);
  await page
    .getByRole('link', { name: `${f.order.number} ↗` })
    .first()
    .click();
  await expect(page).toHaveURL(url);
  await login(page, credentials('manufacturing-reader'));
  await page.goto(url);
  await page.getByRole('button', { name: 'Atelier et stock réel' }).click();
  await expect(trace).toContainText('FINISHED-2026');
  await expect(submit).toHaveCount(0);
  expect(errors).toEqual([]);
});
