import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.WMS_LOTS_TENANT;
test.skip(!tenant, 'Run the isolated wms-lots HTTP fixtures first.');
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
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  const name = `Lots UI ${Date.now()}`;
  const item = await call('post', '/wms/items', {
    sku: crypto.randomUUID(),
    name,
    unit: 'EA',
    lotTracked: true,
  });
  const site = await call('post', '/locations', {
    code: crypto.randomUUID(),
    name: `Site ${name}`,
    type: 'WAREHOUSE',
    addressLine1: '1 Test',
    city: 'Québec',
  });
  const bin = await call('post', '/wms/bins', { locationId: site.id, code: 'LOT-A' });
  return { call, item, site, bin, name };
}
async function choose(page: any, label: string, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${label} :`) }).click();
  const picker = page.getByRole('dialog', { name: label, exact: true });
  await picker.getByRole('textbox').fill(name);
  await picker.getByRole('option').filter({ hasText: name }).click();
  await expect(picker).toHaveCount(0);
}
test('I2k supplier statements: partial totals, immutable correction, exact recovery and mobile', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'FOURNISSEUR-UI' });
  await f.call('post', '/wms/inventory/adjust', {
    itemId: f.item.id,
    lotId: lot.id,
    binId: f.bin.id,
    qtyDelta: 10,
  });
  const supplier = await f.call('post', '/wms/data/suppliers', {
    code: crypto.randomUUID(),
    name: `Suivi ${f.name}`,
  });
  const exit = await f.call('post', '/wms/stock-exits', {
    operationKey: crypto.randomUUID(),
    kind: 'SUPPLIER_RETURN',
    itemId: f.item.id,
    lotId: lot.id,
    binId: f.bin.id,
    quantity: '5.125',
    reason: 'Retour fournisseur avec tri partiel',
    supplierId: supplier.id,
    reference: 'RMA-UI',
    destination: '100 rue du Retour, Québec QC',
  });
  const review = await f.call('get', `/wms/stock-exits/${exit.id}/review`);
  await f.call('post', `/wms/stock-exits/${exit.id}/post`, {
    operationKey: crypto.randomUUID(),
    expectedUpdatedAt: review.expectedUpdatedAt,
    reviewToken: review.reviewToken,
    confirmed: true,
    completionNote: 'Remis physiquement au transporteur du fournisseur.',
  });
  const original = await f.call('get', `/wms/stock-exits/${exit.id}`);
  const session = await page.request.post('/api/v1/auth/login', { data: credentials() });
  const proof = await page.request.post(`/api/v1/wms/stock-exits/${exit.id}/evidence`, {
    headers: { Authorization: `Bearer ${(await session.json()).accessToken}` },
    multipart: {
      operationKey: crypto.randomUUID(),
      caption: 'Constat de tri fournisseur',
      file: {
        name: 'constat.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\nConstat UI'),
      },
    },
  });
  expect(proof.ok()).toBeTruthy();
  await login(page, credentials());
  await page.goto(`/wms/stock-exits?id=${exit.id}`);
  let section = page.getByRole('region', { name: 'Suivi chez le fournisseur', exact: true });
  await section.getByRole('button', { name: 'Consigner le constat fournisseur' }).click();
  await section.getByLabel('Total reçu (EA)', { exact: true }).fill('3.125');
  await section.getByLabel('Total accepté (EA)', { exact: true }).fill('2');
  await section.getByLabel('Total refusé (EA)', { exact: true }).fill('2');
  await expect(section.getByRole('button', { name: 'Enregistrer le constat' })).toBeDisabled();
  await section.getByLabel('Total refusé (EA)', { exact: true }).fill('0.125');
  await section.getByLabel('Référence du constat fournisseur', { exact: true }).fill('CR-UI-1');
  await section
    .getByRole('combobox', { name: 'Justificatif du constat', exact: true })
    .selectOption((await proof.json()).id);
  await section
    .getByLabel('Compte rendu fournisseur', { exact: true })
    .fill('Réception partielle, tri restant en cours.');
  await page.setViewportSize({ width: 390, height: 844 });
  await section.getByLabel('Total reçu (EA)', { exact: true }).scrollIntoViewIfNeeded();
  expect(await section.locator('form').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('supplier-report-form-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  const bodies: unknown[] = [];
  await page.route(`**/api/v1/wms/stock-exits/${exit.id}/supplier-reports`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 2)
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Accès temporairement refusé pendant la reprise.' }),
      });
    const r = await route.fetch();
    if ([1, 4].includes(bodies.length))
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Réponse perdue après enregistrement.' }),
      });
    await route.fulfill({ response: r });
  });
  await section.getByRole('button', { name: 'Enregistrer le constat' }).click();
  await expect(
    section.getByText('Réponse perdue après enregistrement.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  section = page.getByRole('region', { name: 'Suivi chez le fournisseur', exact: true });
  await section.getByRole('button', { name: 'Reprendre la même déclaration' }).click();
  await expect(
    section.getByText('Accès temporairement refusé pendant la reprise.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  section = page.getByRole('region', { name: 'Suivi chez le fournisseur', exact: true });
  await section.getByRole('button', { name: 'Reprendre la même déclaration' }).click();
  await expect(
    section.getByText('Déclaration déjà enregistrée : aucune copie ajoutée.', { exact: true }),
  ).toBeVisible();
  expect(bodies.length).toBe(3);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2]).toEqual(bodies[0]);
  await section.getByRole('button', { name: 'Actualiser le suivi fournisseur' }).click();
  await section.getByLabel('Total accepté (EA)', { exact: true }).fill('1');
  await section.getByLabel('Référence du constat fournisseur', { exact: true }).fill('CR-UI-CORR');
  await section
    .getByRole('combobox', { name: 'Justificatif du constat', exact: true })
    .selectOption({ label: 'Constat de tri fournisseur — constat.pdf' });
  await section
    .getByLabel('Compte rendu fournisseur', { exact: true })
    .fill('Le fournisseur corrige la quantité acceptée.');
  await expect(section.getByRole('button', { name: 'Enregistrer le constat' })).toBeDisabled();
  await section
    .getByLabel('Motif de correction (obligatoire)', { exact: true })
    .fill('Une unité reste finalement à inspecter.');
  await section.getByRole('button', { name: 'Enregistrer le constat' }).click();
  await expect(
    section.getByText('Réponse perdue après enregistrement.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  section = page.getByRole('region', { name: 'Suivi chez le fournisseur', exact: true });
  await section.getByRole('button', { name: 'Vérifier la déclaration' }).click();
  await expect(
    section.getByText('Déclaration déjà enregistrée : aucune copie ajoutée.', { exact: true }),
  ).toBeVisible();
  expect(bodies.length).toBe(4);
  await section.getByText('Historique des constats (2)', { exact: true }).click();
  await expect(section.getByText('Version 1 · CR-UI-1', { exact: true })).toBeVisible();
  await expect(section.getByText('Version 2 · CR-UI-CORR', { exact: true })).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('supplier-report-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('supplier-report-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  expect(await f.call('get', `/wms/stock-exits/${exit.id}`)).toEqual(original);
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, credentials('reader'));
  await page.goto(`/wms/stock-exits?id=${exit.id}`);
  section = page.getByRole('region', { name: 'Suivi chez le fournisseur', exact: true });
  await expect(section.getByText('Historique des constats (2)', { exact: true })).toBeVisible();
  await expect(
    section.getByRole('button', { name: 'Actualiser le suivi fournisseur' }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('I2j linked supplier return and durable file recovery preserve the physical exit proof', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'RETOUR-ACHAT-UI' });
  const supplier = await f.call('post', '/purchasing/data/suppliers', {
    code: crypto.randomUUID(),
    name: `Fournisseur ${f.name}`,
  });
  const product = await f.call('post', '/purchasing/data/items', {
    code: crypto.randomUUID(),
    name: f.name,
    kind: 'GOODS',
    unit: 'EA',
  });
  await f.call('patch', `/purchasing/items/${product.id}/stock-link`, {
    expectedUpdatedAt: product.updatedAt,
    wmsItemId: f.item.id,
  });
  const draft = await f.call('post', '/purchasing/orders', {
    supplierId: supplier.id,
    currency: 'CAD',
    lines: [{ catalogItemId: product.id, quantity: 10, unitPrice: 2 }],
  });
  const order = await f.call('post', `/purchasing/orders/${draft.id}/transition`, {
    expectedUpdatedAt: draft.updatedAt,
    status: 'CONFIRMED',
  });
  await f.call('post', `/purchasing/orders/${order.id}/receipts`, {
    operationKey: crypto.randomUUID(),
    expectedUpdatedAt: order.updatedAt,
    locationId: f.site.id,
    reference: 'BL-UI',
    lines: [{ orderLineId: order.lines[0].id, binId: f.bin.id, lotId: lot.id, quantity: 10 }],
  });
  await login(page, credentials());
  await page.goto(`/wms/stock-exits?itemId=${f.item.id}&lotId=${lot.id}`);
  await page.getByRole('button', { name: 'Préparer une sortie', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: 'Préparer une sortie', exact: true });
  await drawer
    .getByRole('combobox', { name: 'Type de sortie', exact: true })
    .selectOption('SUPPLIER_RETURN');
  await choose(page, 'Emplacement source', f.bin.code);
  await drawer.getByLabel('Quantité dans l’unité de l’article', { exact: true }).fill('3');
  await drawer.getByLabel('Motif de sortie', { exact: true }).fill('Emballage fournisseur abîmé');
  await choose(page, 'Fournisseur du retour', supplier.name);
  await drawer
    .getByLabel('Référence de retour / autorisation fournisseur', { exact: true })
    .fill('RMA-UI-3');
  await drawer
    .getByLabel('Destination de retour confirmée', { exact: true })
    .fill('100 rue du retour, Québec');
  await drawer.getByLabel('Rattacher à une réception d’achat', { exact: true }).check();
  await expect(
    drawer.getByRole('button', { name: 'Préparer sans modifier le stock', exact: true }),
  ).toBeDisabled();
  await page.route('**/api/v1/wms/stock-exits/purchase-sources?*', async (route) => {
    const r = await route.fetch(),
      data = await r.json();
    await route.fulfill({
      response: r,
      json: {
        ...data,
        total: data.total + 1,
        items: [
          {
            id: 'old-proof',
            name: 'Historique incomplet — preuve incomplète',
            token: null,
            remaining: null,
          },
          ...data.items,
        ],
      },
    });
  });
  await choose(page, 'Réception d’achat d’origine', 'Historique incomplet');
  await expect(drawer).toContainText('Preuve de réception incomplète');
  await expect(
    drawer.getByRole('button', { name: 'Préparer sans modifier le stock', exact: true }),
  ).toBeDisabled();
  await choose(page, 'Réception d’achat d’origine', order.number);
  await page.unroute('**/api/v1/wms/stock-exits/purchase-sources?*');
  await drawer
    .getByRole('button', { name: 'Préparer sans modifier le stock', exact: true })
    .click();
  drawer = page.getByRole('dialog');
  await expect(drawer.getByLabel('Réception d’achat rattachée', { exact: true })).toContainText(
    order.number,
  );
  const rows = await f.call('get', `/wms/stock-exits?lotId=${lot.id}`),
    exit = rows.items[0];
  const proof = Buffer.from('%PDF-1.7\nUI supplier return proof'),
    upload = { name: 'bon-retour.pdf', mimeType: 'application/pdf', buffer: proof };
  const files = drawer.getByLabel('Pièces justificatives de sortie', { exact: true });
  await files
    .getByLabel('Fichier justificatif (PDF, PNG, JPEG)', { exact: true })
    .setInputFiles(upload);
  await files
    .getByLabel('Description du justificatif', { exact: true })
    .fill('Autorisation fournisseur conservée');
  let originalKey = '';
  await page.route(`**/api/v1/wms/stock-exits/${exit.id}/evidence`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    originalKey = route
      .request()
      .postData()!
      .match(/name="operationKey"\r\n\r\n([^\r]+)/)![1];
    return route.fulfill({ status: 503, json: { message: 'Réponse perdue après enregistrement' } });
  });
  await files.getByRole('button', { name: 'Conserver le justificatif', exact: true }).click();
  await expect(files).toContainText('Réponse perdue');
  await page.unroute(`**/api/v1/wms/stock-exits/${exit.id}/evidence`);
  await page.goto(`/wms/stock-exits?id=${exit.id}`);
  drawer = page.getByRole('dialog');
  let evidence = drawer.getByLabel('Pièces justificatives de sortie', { exact: true });
  await expect(evidence).toContainText('Pièce en attente');
  await evidence
    .getByLabel('Resélectionner le même justificatif', { exact: true })
    .setInputFiles({ ...upload, buffer: Buffer.from('%PDF-1.7\nWRONG') });
  await evidence.getByRole('button', { name: 'Reprendre la même pièce', exact: true }).click();
  await expect(evidence).toContainText('exactement le même fichier');
  await evidence
    .getByLabel('Resélectionner le même justificatif', { exact: true })
    .setInputFiles(upload);
  let replayKey = '';
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/${exit.id}/evidence`))
      replayKey = r.postData()!.match(/name="operationKey"\r\n\r\n([^\r]+)/)![1];
  });
  await evidence.getByRole('button', { name: 'Reprendre la même pièce', exact: true }).click();
  await expect(evidence).toContainText('Pièce conservée');
  expect(replayKey).toBe(originalKey);
  expect(await f.call('get', `/wms/stock-exits/${exit.id}/evidence`)).toHaveLength(1);
  await drawer.getByRole('button', { name: 'Examiner les effets', exact: true }).click();
  await expect(drawer.getByLabel('Revue de sortie')).toContainText('10');
  await drawer
    .getByLabel('Compte rendu de sortie physique', { exact: true })
    .fill('Trois unités remises physiquement au retour.');
  await drawer.getByRole('checkbox').check();
  await drawer.getByRole('button', { name: 'Enregistrer la sortie physique', exact: true }).click();
  await expect(drawer).toContainText('Dossier fermé');
  evidence = drawer.getByLabel('Pièces justificatives de sortie', { exact: true });
  await evidence
    .getByLabel('Fichier justificatif (PDF, PNG, JPEG)', { exact: true })
    .setInputFiles(upload);
  await evidence
    .getByLabel('Description du justificatif', { exact: true })
    .fill('Bon de remise après sortie');
  await page.route(`**/api/v1/wms/stock-exits/${exit.id}/evidence`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    return route.fulfill({ status: 503, json: { message: 'Accusé de pièce perdu' } });
  });
  await evidence.getByRole('button', { name: 'Conserver le justificatif', exact: true }).click();
  await expect(evidence).toContainText('Accusé de pièce perdu');
  await page.unroute(`**/api/v1/wms/stock-exits/${exit.id}/evidence`);
  await evidence.getByRole('button', { name: 'Vérifier l’enregistrement', exact: true }).click();
  await expect(evidence).toContainText('Pièce déjà enregistrée');
  await expect(
    evidence.getByLabel('Fichier justificatif (PDF, PNG, JPEG)', { exact: true }),
  ).toHaveValue('');
  await expect(evidence).toContainText('Ajout après sortie');
  const download = page.waitForEvent('download');
  await evidence
    .getByRole('button', { name: 'Télécharger bon-retour.pdf', exact: true })
    .first()
    .click();
  expect((await download).suggestedFilename()).toBe('bon-retour.pdf');
  await drawer.evaluate(async (el) => {
    const animations = el.getAnimations({ subtree: true });
    await Promise.all(animations.map((a) => a.finished.catch(() => {})));
  });
  await page.screenshot({
    path: info.outputPath('return-purchase-evidence-desktop.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath('return-purchase-evidence-mobile.png'),
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(
    (await f.call('get', `/wms/items/${f.item.id}/lots/${lot.id}`)).balances[0].qtyOnHand,
  ).toBe('7');
  await login(page, credentials('stock-manager'));
  await page.goto(`/wms/stock-exits?id=${exit.id}`);
  await expect(
    page.getByRole('dialog').getByLabel('Pièces justificatives de sortie', { exact: true }),
  ).toContainText('Bon de remise après sortie');
  await expect(page.getByLabel('Réception d’achat rattachée', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Voir la réception d’achat', exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('I2i documented disposal: real preparation, lost response recovery, journal and mobile', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'REBUT-UI' });
  await f.call('post', '/wms/inventory/adjust', {
    itemId: f.item.id,
    lotId: lot.id,
    binId: f.bin.id,
    qtyDelta: 10,
  });
  await f.call('post', `/wms/items/${f.item.id}/lots/${lot.id}/quarantine`, {
    operationKey: crypto.randomUUID(),
    expectedRevision: 0,
    reason: 'Matière défectueuse',
  });
  await login(page, credentials());
  await page.goto(`/wms/items/${f.item.id}/lots?lotId=${lot.id}`);
  await page
    .getByLabel('Dossiers liés au lot')
    .getByRole('link', { name: 'Sorties documentées', exact: true })
    .click();
  await page.getByRole('button', { name: 'Préparer une sortie', exact: true }).click();
  await choose(page, 'Emplacement source', f.bin.code);
  let drawer = page.getByRole('dialog', { name: 'Préparer une sortie', exact: true });
  await drawer.getByLabel('Quantité dans l’unité de l’article', { exact: true }).fill('2.125');
  await drawer
    .getByLabel('Motif de sortie', { exact: true })
    .fill('Emballage rompu, matière impropre');
  await drawer
    .getByRole('button', { name: 'Préparer sans modifier le stock', exact: true })
    .click();
  drawer = page.getByRole('dialog');
  await expect(
    drawer.getByRole('button', { name: 'Examiner les effets', exact: true }),
  ).toBeVisible();
  expect(
    (await f.call('get', `/wms/items/${f.item.id}/lots/${lot.id}`)).balances[0].qtyOnHand,
  ).toBe('10');
  await drawer.getByRole('button', { name: 'Examiner les effets', exact: true }).click();
  await expect(drawer).toContainText('Le lot restera en quarantaine');
  await drawer
    .getByLabel('Compte rendu de sortie physique', { exact: true })
    .fill('Matière retirée physiquement et rebut vérifié.');
  await drawer.getByRole('checkbox').check();
  const bodies: any[] = [];
  let postUrl = '';
  await page.route('**/api/v1/wms/stock-exits/*/post', async (route) => {
    bodies.push(route.request().postDataJSON());
    postUrl = route.request().url();
    if (bodies.length === 2)
      return route.fulfill({ status: 403, json: { message: 'Droit temporairement indisponible' } });
    const r = await route.fetch();
    expect(r.ok(), await r.text()).toBeTruthy();
    if (bodies.length === 1)
      return route.fulfill({
        status: 503,
        json: { message: 'Réponse perdue après enregistrement' },
      });
    expect((await r.json()).replayed).toBe(true);
    await route.fulfill({ response: r });
  });
  await drawer.getByRole('button', { name: 'Enregistrer la sortie physique', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('Réponse perdue');
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Droit temporairement');
  await expect(
    page.getByRole('button', { name: 'Préparer une sortie', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
  drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('Dossier fermé, preuve conservée');
  expect(bodies).toHaveLength(3);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2]).toEqual(bodies[0]);
  const id = postUrl.split('/').at(-2)!;
  const row = await f.call('get', `/wms/stock-exits/${id}`);
  expect(row.status).toBe('POSTED');
  const l = await f.call('get', `/wms/items/${f.item.id}/lots/${lot.id}`);
  expect(l.disposition).toBe('QUARANTINED');
  expect(l.balances[0].qtyOnHand).toBe('7.875');
  await expect
    .poll(() =>
      drawer.evaluate((el) => {
        let opacity = 1;
        for (let node: Element | null = el; node; node = node.parentElement)
          opacity *= Number(getComputedStyle(node).opacity);
        return opacity;
      }),
    )
    .toBe(1);
  await page.screenshot({
    path: info.outputPath('stock-exit-desktop.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('stock-exit-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
  await drawer.getByRole('link', { name: 'Voir la preuve de stock', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('refType=stock-exit'));
  await expect(page.getByRole('link', { name: `${row.number} ↗`, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('I2i supplier return form, explicit source selection, cancellation and readonly rights', async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await fixture(page);
  const lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'RETOUR-UI' });
  await f.call('post', '/wms/inventory/adjust', {
    itemId: f.item.id,
    lotId: lot.id,
    binId: f.bin.id,
    qtyDelta: 5,
  });
  const supplier = await f.call('post', '/wms/data/suppliers', {
    code: crypto.randomUUID(),
    name: `Retour ${Date.now()}`,
  });
  await login(page, credentials());
  await page.goto('/wms/stock-exits');
  await page.getByRole('button', { name: 'Préparer une sortie', exact: true }).click();
  let drawer = page.getByRole('dialog', { name: 'Préparer une sortie', exact: true });
  await drawer
    .getByRole('combobox', { name: 'Type de sortie', exact: true })
    .selectOption('SUPPLIER_RETURN');
  await choose(page, 'Article suivi par lot', f.name);
  await choose(page, 'Lot à sortir', lot.code);
  await choose(page, 'Emplacement source', f.bin.code);
  await drawer.getByLabel('Quantité dans l’unité de l’article', { exact: true }).fill('1');
  await drawer
    .getByLabel('Motif de sortie', { exact: true })
    .fill('Retour convenu avec le fournisseur');
  await choose(page, 'Fournisseur du retour', supplier.name);
  await drawer
    .getByLabel('Référence de retour / autorisation fournisseur', { exact: true })
    .fill('RMA-2026');
  await drawer
    .getByLabel('Destination de retour confirmée', { exact: true })
    .fill('1 rue Fournisseur, Montréal QC');
  await drawer
    .getByRole('button', { name: 'Préparer sans modifier le stock', exact: true })
    .click();
  drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('RMA-2026');
  await drawer.getByLabel('Motif d’annulation', { exact: true }).fill('Destination à reconfirmer');
  await drawer.getByRole('button', { name: 'Annuler le brouillon', exact: true }).click();
  await expect(drawer).toContainText('Dossier fermé, preuve conservée');
  expect(
    (await f.call('get', `/wms/items/${f.item.id}/lots/${lot.id}`)).balances[0].qtyOnHand,
  ).toBe('5');
  const d = await f.call('post', '/wms/stock-exits', {
    operationKey: crypto.randomUUID(),
    kind: 'DISPOSAL',
    itemId: f.item.id,
    lotId: lot.id,
    binId: f.bin.id,
    quantity: '1',
    reason: 'Gestionnaire sans droit de sortie',
  });
  await login(page, credentials('stock-manager'));
  await page.goto(`/wms/stock-exits?id=${d.id}`);
  drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('wms.stock.dispose');
  await expect(
    drawer.getByRole('button', { name: 'Enregistrer la sortie physique', exact: true }),
  ).toHaveCount(0);
});

test('Quality lot control: real UI round trip, linked release recovery, affected preparations and mobile', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'QUALITE-LOT-UI' });
  const path = `/wms/items/${f.item.id}/lots/${lot.id}`,
    view = `/wms/items/${f.item.id}/lots?lotId=${lot.id}`;
  await f.call('post', '/wms/inventory/adjust', {
    itemId: f.item.id,
    lotId: lot.id,
    binId: f.bin.id,
    qtyDelta: 10,
  });
  const pick = await f.call('post', '/wms/pick-orders', { locationId: f.site.id });
  await f.call('post', `/wms/pick-orders/${pick.id}/lines`, {
    itemId: f.item.id,
    lotId: lot.id,
    fromBinId: f.bin.id,
    qty: 2,
    expectedUpdatedAt: pick.updatedAt,
  });
  await f.call('post', `${path}/quarantine`, {
    operationKey: crypto.randomUUID(),
    expectedRevision: 0,
    reason: 'Échantillon à vérifier',
  });
  const plan = await f.call('post', '/quality/plans', {
    code: 'QC-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
    name: `Aspect ${Date.now()}`,
    instructions: 'Vérifier avant libération',
    active: true,
    criteria: [{ key: 'aspect', label: 'Aspect', kind: 'CHECK' }],
  });
  await login(page, credentials());
  await page.goto(view);
  await page.getByRole('button', { name: 'Préparations à revoir', exact: true }).click();
  await expect(page.getByRole('link', { name: pick.number, exact: true })).toHaveAttribute(
    'href',
    `/wms/picking/${pick.id}`,
  );
  await page.getByRole('link', { name: 'Préparer un contrôle', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Nouveau contrôle', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel('Type de dossier source')).toHaveValue('LOT');
  await choose(page, 'Plan actif', plan.name);
  await drawer.getByRole('button', { name: 'Créer le contrôle', exact: true }).click();
  await expect(page).toHaveURL(/\/quality\/inspections\//);
  const qcId = page.url().split('/').pop()!;
  await expect(page.getByText(/Lot capturé/)).toBeVisible();
  await page.getByRole('button', { name: 'Démarrer le contrôle', exact: true }).click();
  let modal = page.getByRole('dialog', { name: 'Confirmer la décision', exact: true });
  await modal.getByLabel('Compte rendu ou motif').fill('Inspection visuelle commencée');
  await modal.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByLabel('Résultat : Aspect', { exact: true }).selectOption('PASS');
  await page.getByRole('button', { name: 'Enregistrer les résultats', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Terminer le contrôle', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Terminer le contrôle', exact: true }).click();
  modal = page.getByRole('dialog', { name: 'Confirmer la décision', exact: true });
  await modal.getByLabel('Compte rendu ou motif').fill('Matière inspectée et conforme');
  await modal.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByText('Contrôle conforme', { exact: true })).toBeVisible();
  const qc = await f.call('get', `/quality/inspections/${qcId}`);
  expect((await f.call('get', path)).disposition).toBe('QUARANTINED');
  await page.getByRole('link', { name: /Ouvrir le dossier source/ }).click();
  await expect(page).toHaveURL(new RegExp(`lotId=${lot.id}`));
  await page.getByRole('button', { name: 'Contrôles Qualité', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(qc.number) })).toBeVisible();
  await page.getByRole('button', { name: 'Libérer après contrôle', exact: true }).click();
  await page.getByLabel('Motif de la décision', { exact: true }).fill('Contrôle lot conforme');
  await page
    .getByLabel('Contrôle réalisé et résultat', { exact: true })
    .fill('Aspect vérifié sur le lot, aucune anomalie détectée.');
  await page.getByLabel('Justificatif de libération', { exact: true }).selectOption('quality');
  await choose(page, 'Contrôle conforme', qc.number);
  await page.getByRole('checkbox', { name: /Je confirme le contrôle/ }).check();
  await expect(
    page.getByRole('button', { name: 'Confirmer la libération', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath('quality-lot-desktop.png'), fullPage: true });
  let sent: any;
  await page.route(`**/api/v1${path}/release`, async (route) => {
    sent = route.request().postDataJSON();
    expect((await route.fetch()).ok()).toBeTruthy();
    await route.fulfill({ status: 503, json: { message: 'Réponse perdue après libération' } });
  });
  await page.getByRole('button', { name: 'Confirmer la libération', exact: true }).click();
  await expect(page.getByText('Décision à confirmer', { exact: true })).toBeVisible();
  expect(sent.qualityInspectionId).toBe(qcId);
  expect(sent.expectedInspectionUpdatedAt).toBe(qc.updatedAt);
  await page.unroute(`**/api/v1${path}/release`);
  await page.reload();
  await page.route(`**/api/v1${path}/release`, (route) =>
    route.fulfill({
      status: 403,
      json: { message: 'Lecture Qualité temporairement indisponible' },
    }),
  );
  await page.getByRole('button', { name: 'Reprendre la même décision', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('temporairement');
  await page.unroute(`**/api/v1${path}/release`);
  await page.reload();
  await page.route(`**/api/v1${path}/release`, async (route) => {
    expect(route.request().postDataJSON()).toEqual(sent);
    await route.continue();
  });
  await page.getByRole('button', { name: 'Reprendre la même décision', exact: true }).click();
  await expect(page.getByText('Décision à confirmer', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Preuve figée/)).toBeVisible();
  const history = await f.call('get', `${path}/decisions`);
  expect(history.total).toBe(2);
  expect(history.items[0].qualitySnapshot.id).toBe(qcId);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByText(/Preuve figée/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('quality-lot-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  await login(page, credentials('stock-release'));
  await page.goto(view);
  await expect(page.getByRole('button', { name: 'Contrôles Qualité', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Historique des contrôles', exact: true }).click();
  await expect(page.getByText(/Preuve figée/)).toHaveCount(0);
});

test('Quality first entry teaches lot selection before results and stays quiet on next visit', async ({
  page,
}) => {
  const f = await fixture(page);
  const roles = await f.call('get', '/roles');
  const role = (Array.isArray(roles) ? roles : roles.items).find(
    (r: { key: string }) => r.key === 'manager',
  );
  const newcomer = {
    tenant: tenant!,
    email: `quality-tour-${crypto.randomUUID()}@${tenant}.test`,
    password: 'Test1234!',
  };
  await f.call('post', '/users', {
    email: newcomer.email,
    password: newcomer.password,
    firstName: 'Qualité',
    lastName: 'Première visite',
    roleIds: [role.id],
  });
  await login(page, newcomer);
  await page.unroute('**/api/v1/me/preferences');
  await page.goto('/quality');
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Étape 1 sur 6');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('rattacher après coup');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Un PASS ne libère rien');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Terminer', exact: true }).click();
  await expect(tour).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Qualité', exact: true })).toBeVisible();
  await expect(tour).toHaveCount(0);
});

test('Quality lot control explains stale material and blocks completion in the UI', async ({
  page,
}) => {
  const f = await fixture(page);
  const lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'STALE-QC-UI' });
  const plan = await f.call('post', '/quality/plans', {
    code: 'QC-' + crypto.randomUUID().slice(0, 8).toUpperCase(),
    name: 'Contrôle matière',
    instructions: 'Vérifier',
    active: true,
    criteria: [{ key: 'aspect', label: 'Aspect', kind: 'CHECK' }],
  });
  let qc = await f.call('post', '/quality/inspections', {
    planId: plan.id,
    title: 'Lot changé',
    sourceKind: 'LOT',
    sourceId: lot.id,
    operationKey: crypto.randomUUID(),
  });
  qc = await f.call('post', `/quality/inspections/${qc.id}/transition`, {
    status: 'IN_PROGRESS',
    expectedUpdatedAt: qc.updatedAt,
    note: 'Début du contrôle',
  });
  qc = await f.call('patch', `/quality/inspections/${qc.id}/results`, {
    expectedUpdatedAt: qc.updatedAt,
    results: [{ key: 'aspect', value: 'PASS', note: '' }],
  });
  await f.call('post', '/wms/inventory/adjust', {
    itemId: f.item.id,
    lotId: lot.id,
    binId: f.bin.id,
    qtyDelta: 1,
  });
  await login(page, credentials());
  await page.goto(`/quality/inspections/${qc.id}`);
  await expect(page.getByText(/Le lot a changé depuis la préparation/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Terminer le contrôle', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Annuler le contrôle avec un motif', exact: true }),
  ).toBeEnabled();
});
test('Quarantine: documented release, exact recovery after lost response, rights and mobile', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'CONTROLE-051' });
  const path = `/wms/items/${f.item.id}/lots/${lot.id}`;
  await f.call('post', '/wms/inventory/adjust', {
    itemId: f.item.id,
    lotId: lot.id,
    binId: f.bin.id,
    qtyDelta: 8,
  });
  await login(page, credentials());
  await page.goto(`/wms/items/${f.item.id}/lots`);
  await page.getByRole('button', { name: 'Mettre en quarantaine', exact: true }).click();
  await page
    .getByLabel('Motif de la décision', { exact: true })
    .fill('Emballage humide, vérifier la matière');
  await page.getByRole('checkbox', { name: /Je confirme le blocage/ }).check();
  let attempts = 0;
  await page.route(`**/api/v1${path}/quarantine`, async (route) => {
    attempts++;
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    await route.fulfill({ status: 503, json: { message: 'Réponse de quarantaine perdue' } });
  });
  await page.getByRole('button', { name: 'Confirmer la quarantaine', exact: true }).click();
  await expect(page.getByText('Décision à confirmer', { exact: true })).toBeVisible();
  await page.unroute(`**/api/v1${path}/quarantine`);
  await page.reload();
  await expect(page.getByText('En quarantaine · sorties bloquées', { exact: false })).toBeVisible();
  await page.route(`**/api/v1${path}/quarantine`, (route) =>
    route.fulfill({ status: 403, json: { message: 'Accès temporairement refusé' } }),
  );
  await page.getByRole('button', { name: 'Reprendre la même décision', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Accès temporairement');
  await page.unroute(`**/api/v1${path}/quarantine`);
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la même décision', exact: true }).click();
  await expect(page.getByText('Décision à confirmer', { exact: true })).toHaveCount(0);
  expect(attempts).toBe(1);
  expect((await f.call('get', `${path}/decisions`)).total).toBe(1);
  await page.screenshot({ path: info.outputPath('quarantine-desktop.png'), fullPage: true });
  await login(page, credentials('stock-manager'));
  await page.goto(`/wms/items/${f.item.id}/lots`);
  await expect(page.getByText(/La libération exige le droit/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Libérer après contrôle', exact: true }),
  ).toHaveCount(0);
  await login(page, credentials());
  await page.goto(`/wms/items/${f.item.id}/lots`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Libérer après contrôle', exact: true }).click();
  await page
    .getByLabel('Motif de la décision', { exact: true })
    .fill('Contrôle terminé, lot utilisable');
  await page
    .getByLabel('Contrôle réalisé et résultat', { exact: true })
    .fill('Échantillon inspecté selon fiche matière, résultat conforme. Contrôle QC-051.');
  await page.getByRole('checkbox', { name: /Je confirme le contrôle/ }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('quarantine-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Confirmer la libération', exact: true }).click();
  await expect(page.getByText(/Sans blocage de stock/)).toBeVisible();
  expect((await f.call('get', `${path}/decisions`)).total).toBe(2);
  expect(errors).toEqual([]);
});
test('Quarantine does not send a decision when local recovery storage fails', async ({ page }) => {
  const f = await fixture(page);
  await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'STORAGE-CHECK' });
  await login(page, credentials());
  await page.goto(`/wms/items/${f.item.id}/lots`);
  await page.getByRole('button', { name: 'Mettre en quarantaine', exact: true }).click();
  await page.getByLabel('Motif de la décision', { exact: true }).fill('Vérification nécessaire');
  await page.getByRole('checkbox', { name: /Je confirme le blocage/ }).check();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.startsWith('pulsar:lot-decision:')) throw Error('storage unavailable');
      return original.call(this, k, v);
    };
  });
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/quarantine')) writes++;
  });
  await page.getByRole('button', { name: 'Confirmer la quarantaine', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Aucune demande envoyée');
  expect(writes).toBe(0);
});
test('Lot creation: lost response reread, civil dates, reader rights, desktop/mobile', async ({
  page,
}, info) => {
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials());
  await page.goto(`/wms/items/${f.item.id}/lots`);
  await page.getByRole('button', { name: 'Créer un lot', exact: true }).click();
  await page.getByLabel('Numéro de lot', { exact: true }).fill('FAB-001');
  await page.getByLabel('Lot fournisseur (facultatif)', { exact: true }).fill('FOURN-039');
  await page.getByLabel('Date de fabrication', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Date de péremption', { exact: true }).fill('2027-09-01');
  let writes = 0;
  await page.route(`**/api/v1/wms/items/${f.item.id}/lots`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++;
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    await route.fulfill({ status: 503, json: { message: 'Réponse simulée perdue' } });
  });
  await page.getByRole('button', { name: 'Enregistrer le lot', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Enregistrer le lot', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Relire les lots enregistrés', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'FAB-001', exact: true })).toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByText('0 EA en stock', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('lots-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('lots-mobile.png') });
  expect(errors).toEqual([]);
  await login(page, credentials('reader'));
  await page.goto(`/wms/items/${f.item.id}/lots`);
  await expect(page.getByRole('heading', { name: 'FAB-001', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Créer un lot', exact: true })).toHaveCount(0);
});
test('Supplier lot selection, exact recovery after lost receipt response, proof and journal', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const f = await fixture(page),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const lot = await f.call('post', `/wms/items/${f.item.id}/lots`, {
    code: 'ARRIVAGE-031',
    expiresOn: '2027-09-01',
  });
  const catalog = await f.call('post', '/purchasing/data/items', {
    code: crypto.randomUUID(),
    name: f.name,
    kind: 'GOODS',
    unit: 'EA',
  });
  const supplier = await f.call('post', '/purchasing/data/suppliers', {
    code: crypto.randomUUID(),
    name: 'Fournisseur lots UI',
  });
  await f.call('patch', `/purchasing/items/${catalog.id}/stock-link`, {
    wmsItemId: f.item.id,
    expectedUpdatedAt: catalog.updatedAt,
  });
  const draft = await f.call('post', '/purchasing/orders', {
    supplierId: supplier.id,
    currency: 'CAD',
    lines: [{ catalogItemId: catalog.id, quantity: 8, unitPrice: 2 }],
  });
  const order = await f.call('post', `/purchasing/orders/${draft.id}/transition`, {
    status: 'CONFIRMED',
    expectedUpdatedAt: draft.updatedAt,
  });
  await login(page, credentials());
  await page.goto(`/purchasing/orders/${order.id}/receiving`);
  await choose(page, 'Entrepôt de réception', f.site.name);
  await page.getByLabel('Bon de livraison ou référence', { exact: true }).fill('BL-LOTS-UI');
  await page.getByLabel('Quantité reçue maintenant', { exact: true }).fill('3');
  await choose(page, `Emplacement pour ${f.name}`, f.bin.code);
  await page.getByRole('checkbox', { name: /Je confirme l’arrivée physique/ }).check();
  await expect(
    page.getByRole('button', { name: 'Confirmer la réception physique', exact: true }),
  ).toBeDisabled();
  await choose(page, 'Lot de stock', lot.code);
  await expect(
    page.getByRole('button', { name: 'Confirmer la réception physique', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath('supplier-lot-choice.png') });
  const bodies: any[] = [];
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
  expect(bodies[0].lines[0].lotId).toBe(lot.id);
  await expect(page.getByRole('region', { name: 'Historique des arrivages' })).toContainText(
    'Lot ARRIVAGE-031',
  );
  await page.goto(`/wms/movements?lotId=${lot.id}`);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article')).toContainText('ARRIVAGE-031');
  expect(errors).toEqual([]);
});
test('Guided preparation chooses an explicit lot and displays its own stock', async ({ page }) => {
  const f = await fixture(page),
    lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'PICK-LOT' });
  await f.call('post', '/wms/inventory/adjust', {
    itemId: f.item.id,
    binId: f.bin.id,
    lotId: lot.id,
    qtyDelta: 4,
  });
  const pick = await f.call('post', '/wms/pick-orders', { locationId: f.site.id });
  await login(page, credentials());
  await page.goto(`/wms/picking/${pick.id}`);
  await page.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click();
  await choose(page, 'Article', f.name);
  await choose(page, 'Emplacement', f.bin.code);
  await page.getByLabel('Quantité (EA)', { exact: true }).fill('2');
  await expect(
    page.getByRole('button', { name: 'Enregistrer la ligne', exact: true }),
  ).toBeDisabled();
  await choose(page, 'Lot de stock', lot.code);
  await expect(page.getByText(/Stock de ce lot dans l’emplacement :/)).toContainText('4');
  await page.getByRole('button', { name: 'Enregistrer la ligne', exact: true }).click();
  await expect(page.getByRole('article', { name: `Ligne ${f.item.sku}` })).toContainText(
    'Lot PICK-LOT',
  );
  await expect(page.getByRole('article', { name: `Ligne ${f.item.sku}` })).toContainText(
    'Stock du lot',
  );
  const saved = await f.call('get', `/wms/pick-orders/${pick.id}`);
  expect(saved.lines[0].lotId).toBe(lot.id);
  expect(saved.readiness.canExecute).toBe(true);
  const plain = await f.call('post', '/wms/items', {
    sku: crypto.randomUUID(),
    name: `Sans lot ${f.name}`,
    unit: 'EA',
  });
  await page.getByRole('button', { name: `Modifier ${f.item.sku}`, exact: true }).click();
  await choose(page, 'Article', plain.name);
  await expect(page.getByRole('button', { name: /^Lot de stock :/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enregistrer la ligne', exact: true }).click();
  await expect(page.getByRole('article', { name: `Ligne ${plain.sku}` })).toBeVisible();
  const changed = await f.call('get', `/wms/pick-orders/${pick.id}`);
  expect(changed.lines[0].lotId).toBeNull();
});
test('First WMS visit teaches lot-specific steps only once per user', async ({ page }) => {
  const f = await fixture(page),
    roles = await f.call('get', '/roles'),
    role = (Array.isArray(roles) ? roles : roles.items).find((r: any) => r.key === 'reader');
  const fresh = { ...credentials(), email: `tour-lots-${crypto.randomUUID()}@example.test` };
  await f.call('post', '/users', {
    email: fresh.email,
    password: fresh.password,
    firstName: 'Guide',
    lastName: 'Lots',
    roleIds: [role.id],
  });
  await login(page, fresh);
  await page.unroute('**/api/v1/me/preferences');
  await page.goto('/wms');
  const tour = page.getByTestId('module-tour').getByRole('dialog');
  await expect(tour).toBeVisible();
  for (let i = 0; i < 8; i++) {
    if (
      await tour
        .getByText('Choisir le suivi puis identifier les lots', { exact: true })
        .isVisible()
        .catch(() => false)
    )
      break;
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  }
  await expect(
    tour.getByText('Choisir le suivi puis identifier les lots', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(tour).toHaveCount(0);
});
test('Putaway keeps the lot through confirmation and movement', async ({ page }) => {
  const f = await fixture(page),
    lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'MOVE-LOT' });
  const source = await f.call('post', '/wms/bins', {
    locationId: f.site.id,
    code: 'RECEIVING-LOT',
    kind: 'RECEIVING',
  });
  await f.call('post', '/wms/inventory/adjust', {
    itemId: f.item.id,
    binId: source.id,
    lotId: lot.id,
    qtyDelta: 5,
  });
  await login(page, credentials());
  await page.goto(`/wms/putaway?site=${f.site.id}`);
  await page.getByRole('button', { name: `Ranger ${f.item.sku}`, exact: true }).click();
  await choose(page, 'Destination', f.bin.code);
  await page.getByRole('spinbutton', { name: 'Quantité (EA)', exact: true }).fill('2');
  await expect(
    page.getByRole('button', { name: 'Vérifier le déplacement', exact: true }),
  ).toBeDisabled();
  await choose(page, 'Lot de stock', lot.code);
  await page.getByRole('button', { name: 'Vérifier le déplacement', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirmer le déplacement', exact: true });
  await expect(confirm).toContainText('lot MOVE-LOT');
  await confirm.getByRole('button', { name: 'Déplacer le stock', exact: true }).click();
  await expect(page.getByRole('dialog', { name: `Ranger ${f.item.sku}`, exact: true })).toHaveCount(
    0,
  );
  const saved = await f.call('get', `/wms/items/${f.item.id}/lots/${lot.id}`);
  expect(saved.balances.find((b: any) => b.binId === source.id).qtyOnHand).toBe('3');
  expect(saved.balances.find((b: any) => b.binId === f.bin.id).qtyOnHand).toBe('2');
});

test('I2b count separates lots, requires zero, resolves ambiguous scans and posts once', async ({
  page,
}, info) => {
  const f = await fixture(page);
  const a = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'COUNT-A' });
  const b = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'COUNT-B' });
  for (const lot of [a, b])
    await f.call('post', '/wms/inventory/adjust', {
      itemId: f.item.id,
      binId: f.bin.id,
      lotId: lot.id,
      qtyDelta: 2,
    });
  const cc = await f.call('post', '/wms/cycle-counts', { binId: f.bin.id });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials());
  await page.goto('/wms/cycle-counts');
  await page.getByRole('button', { name: new RegExp(cc.number) }).click();
  await expect(page.getByRole('table').getByText('Lot COUNT-A', { exact: true })).toBeVisible();
  const otherCount = await f.call('post', '/wms/cycle-counts', { binId: f.bin.id });
  await page.reload();
  await page.getByRole('button', { name: new RegExp(cc.number) }).click();
  // Finish opening the first dossier before requesting another: concurrent opens
  // are intentionally ignored by the UI while its current read is pending.
  await expect(
    page.getByRole('button', { name: 'Enregistrer le comptage', exact: true }),
  ).toBeEnabled();
  let release!: () => void;
  let intercepted = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/v1/wms/cycle-counts/${otherCount.id}`, async (route) => {
    intercepted = true;
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: new RegExp(otherCount.number) }).click();
  try {
    await expect.poll(() => intercepted).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Enregistrer le comptage', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeDisabled();
  } finally {
    release();
  }
  await expect(
    page.getByRole('button', { name: 'Enregistrer le comptage', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: new RegExp(cc.number) }).click();
  await expect(
    page.getByRole('button', { name: 'Enregistrer le comptage', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Mode de comptage').selectOption('increment');
  const scan = page.getByRole('textbox', { name: 'Scanner l’article à compter' });
  await scan.fill(f.item.sku);
  await scan.press('Enter');
  // The explicit chooser is not a modal; a scan never guesses one of the lots.
  const lotButton = page.getByRole('button', { name: 'COUNT-B', exact: true });
  await expect(lotButton).toBeVisible();
  const qtyA = page.getByRole('spinbutton', {
    name: `Quantité comptée : ${f.item.sku} · COUNT-A`,
    exact: true,
  });
  const qtyB = page.getByRole('spinbutton', {
    name: `Quantité comptée : ${f.item.sku} · COUNT-B`,
    exact: true,
  });
  await expect(qtyA).toHaveValue('');
  await expect(qtyB).toHaveValue('');
  await lotButton.click();
  await expect(qtyB).toHaveValue('1');
  await page.getByRole('button', { name: 'Enregistrer le comptage', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmer', exact: true })).toHaveCount(0);
  await qtyA.fill('0');
  await qtyA.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('count-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await qtyA.scrollIntoViewIfNeeded();
  const card = page.getByRole('article', { name: `Comptage ${f.item.sku} · COUNT-A`, exact: true });
  expect((await card.boundingBox())!.width).toBeLessThan(391);
  await expect(card.getByText('Système', { exact: true })).toBeVisible();
  await expect(card.getByText('Écart', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('count-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Enregistrer le comptage', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Réconcilier', exact: true })).toBeEnabled();
  let reconciles = 0;
  await page.route(`**/api/v1/wms/cycle-counts/${cc.id}/reconcile`, async (route) => {
    reconciles++;
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    await route.fulfill({ status: 503, json: { message: 'Réponse perdue après commit' } });
  });
  await page.getByRole('button', { name: 'Réconcilier', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Réconcilier', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Réconcilier', exact: true })).toHaveCount(0);
  expect(reconciles).toBe(1);
  expect((await f.call('get', `/wms/items/${f.item.id}/lots/${a.id}`)).balances[0].qtyOnHand).toBe(
    '0',
  );
  expect((await f.call('get', `/wms/items/${f.item.id}/lots/${b.id}`)).balances[0].qtyOnHand).toBe(
    '1',
  );
  expect(errors).toEqual([]);
  await login(page, credentials('reader'));
  await page.goto('/wms/cycle-counts');
  await page.getByRole('button', { name: new RegExp(cc.number) }).click();
  await expect(page.getByRole('table').getByText('Lot COUNT-A', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Démarrer le comptage', exact: true })).toHaveCount(
    0,
  );
});

test('I2b stale bin snapshot explains blocked count and allows explicit cancellation', async ({
  page,
}) => {
  const f = await fixture(page),
    lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'STALE' });
  const adjust = (qtyDelta: number) =>
    f.call('post', '/wms/inventory/adjust', {
      itemId: f.item.id,
      binId: f.bin.id,
      lotId: lot.id,
      qtyDelta,
    });
  await adjust(3);
  const cc = await f.call('post', '/wms/cycle-counts', { binId: f.bin.id });
  await adjust(1);
  await adjust(-1);
  await login(page, credentials());
  await page.goto('/wms/cycle-counts');
  await page.getByRole('button', { name: new RegExp(cc.number) }).click();
  await expect(page.getByText(/Le stock de cet emplacement a bougé/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Enregistrer le comptage', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Enregistrer le comptage', exact: true }),
  ).toHaveCount(0);
  expect((await f.call('get', `/wms/cycle-counts/${cc.id}`)).status).toBe('CANCELLED');
});

test('I2b adjustment survives reload and replays the exact lot/delta/key without double stock', async ({
  page,
}, info) => {
  const f = await fixture(page),
    lot = await f.call('post', `/wms/items/${f.item.id}/lots`, { code: 'ADJUST-LOT' });
  await f.call('post', '/wms/inventory/adjust', {
    itemId: f.item.id,
    binId: f.bin.id,
    lotId: lot.id,
    qtyDelta: 5,
  });
  await login(page, credentials());
  await page.goto('/wms/inventory');
  await page.getByRole('button', { name: 'Ajuster', exact: true }).click();
  await choose(page, 'Article', f.name);
  // The bin list can contain other fixtures with the same code: give this one an unambiguous code.
  const uniqueBin = `ADJ-${Date.now()}`;
  await f.call('patch', `/wms/bins/${f.bin.id}`, { code: uniqueBin });
  await choose(page, 'Bin', uniqueBin);
  await page.getByRole('spinbutton', { name: 'Delta (peut être négatif)', exact: true }).fill('-2');
  await choose(page, 'Lot de stock', lot.code);
  const bodies: any[] = [];
  await page.route('**/api/v1/wms/inventory/adjust', async (route) => {
    bodies.push(route.request().postDataJSON());
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    if (bodies.length === 1)
      await route.fulfill({ status: 503, json: { message: 'Réponse perdue' } });
    else {
      expect((await r.json()).replayed).toBe(true);
      await route.fulfill({ response: r });
    }
  });
  const modal = page.getByRole('dialog', { name: 'Ajuster le stock', exact: true });
  await modal.getByRole('button', { name: 'Ajuster', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirmer l’ajustement', exact: true });
  await expect(confirm).toContainText('lot ADJUST-LOT');
  await confirm.getByRole('button', { name: 'Ajuster le stock', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Ajuster', exact: true })).toBeDisabled();
  await page.reload();
  const recovery = page.getByRole('complementary', { name: 'Ajustement à vérifier' });
  await expect(recovery).toContainText('lot ADJUST-LOT');
  await page.screenshot({ path: info.outputPath('adjust-recovery.png') });
  await recovery.getByRole('button', { name: 'Vérifier et reprendre', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Reprendre l’ajustement' })
    .getByRole('button', { name: 'Vérifier et reprendre', exact: true })
    .click();
  await expect(recovery).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0].lotId).toBe(lot.id);
  expect(
    (await f.call('get', `/wms/items/${f.item.id}/lots/${lot.id}`)).balances[0].qtyOnHand,
  ).toBe('3');
});
