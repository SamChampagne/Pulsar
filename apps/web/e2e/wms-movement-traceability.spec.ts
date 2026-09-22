import { test, expect, type Page } from './fixtures';
import { login } from './helpers';

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});
async function setup(page: Page, start = '/wms/putaway?site=site-a') {
  await login(page);
  const site = { id: 'site-a', code: 'LAV', name: 'Centre Laval', type: 'WAREHOUSE' };
  const bin = {
    id: 'storage',
    code: 'A-01',
    name: 'A-01 · Allée A',
    zone: 'Allée A',
    kind: 'STORAGE',
    isActive: true,
    locationId: site.id,
  };
  const rows = [
    {
      itemId: 'ea',
      sku: 'KIT',
      name: 'Ensemble de montage',
      unit: 'EA',
      qtyOnHand: '17',
      isActive: true,
      binId: 'receiving',
      binCode: 'RC-01',
      binActive: true,
      zone: 'Quai',
      locationId: site.id,
    },
    {
      itemId: 'kg',
      sku: 'VRAC',
      name: 'Matière première',
      unit: 'KG',
      qtyOnHand: '2.125',
      isActive: false,
      binId: 'inactive',
      binCode: 'RC-OFF',
      binActive: false,
      zone: 'Quai fermé',
      locationId: site.id,
    },
  ];
  const fromBin = { id: 'receiving', code: 'RC-01', locationId: site.id, locationName: site.name };
  const movements = [
    {
      id: 'm1',
      type: 'MOVE',
      createdAt: '2026-09-14T14:00:00Z',
      qty: '4',
      unit: 'EA',
      unitCaptured: true,
      item: { id: 'ea', sku: 'KIT', name: 'Ensemble de montage' },
      fromBin,
      toBin: { ...fromBin, id: 'storage', code: 'A-01' },
      actor: 'Marie Roy',
      note: 'Rangement confirmé',
      source: null,
    },
    {
      id: 'm2',
      type: 'RECEIPT',
      createdAt: '2026-09-14T13:00:00Z',
      qty: '2.125',
      unit: 'KG',
      unitCaptured: false,
      item: { id: 'kg', sku: 'VRAC', name: 'Matière première' },
      fromBin: null,
      toBin: fromBin,
      actor: 'Marie Roy',
      note: null,
      source: { kind: 'receipt', id: 'receipt-a', number: 'RC-200' },
    },
  ];
  const requests: URL[] = [],
    writes: any[] = [];
  let failPutaway = false,
    failJournal = false;
  await page.route('**/api/v1/wms/**', (r) => {
    const url = new URL(r.request().url()),
      path = url.pathname.replace('/api/v1/wms/', '');
    requests.push(url);
    if (r.request().method() !== 'GET') {
      writes.push(r.request().postDataJSON());
      return r.fulfill({ status: 500, json: { message: 'Écriture inattendue' } });
    }
    if (path === 'sites')
      return r.fulfill({ json: { items: [site], total: 1, page: 1, pageSize: 20 } });
    if (path === 'sites/site-a') return r.fulfill({ json: site });
    if (path === 'sites/site-a/bins')
      return r.fulfill({ json: { items: [bin], total: 1, page: 1, pageSize: 20 } });
    if (path === 'sites/site-a/bins/storage') return r.fulfill({ json: bin });
    if (path === 'putaway')
      return r.fulfill(
        failPutaway
          ? { status: 503, json: { message: 'Rangement indisponible test' } }
          : {
              json: {
                site,
                generatedAt: new Date().toISOString(),
                items: rows,
                total: 31,
                page: Number(url.searchParams.get('page') || 1),
                pageSize: 30,
              },
            },
      );
    if (path === 'inventory/movements')
      return r.fulfill(
        failJournal
          ? { status: 503, json: { message: 'Journal indisponible test' } }
          : {
              json: {
                generatedAt: new Date().toISOString(),
                items: movements,
                total: 31,
                page: Number(url.searchParams.get('page') || 1),
                pageSize: 30,
              },
            },
      );
    return r.fulfill({ status: 404, json: { message: 'Lecture non prévue' } });
  });
  await page.goto(start);
  await expect(
    page.getByRole('heading', {
      name: start.includes('movements') ? 'Journal des mouvements' : 'Rangement',
      exact: true,
    }),
  ).toBeVisible();
  return {
    rows,
    movements,
    requests,
    writes,
    failPutaway: () => {
      failPutaway = true;
    },
    failJournal: () => {
      failJournal = true;
    },
  };
}
async function form(page: Page) {
  await page.getByRole('button', { name: 'Ranger KIT', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Ranger KIT', exact: true });
  await panel.getByRole('button', { name: /^Destination :/ }).click();
  await page
    .getByRole('dialog', { name: 'Destination', exact: true })
    .getByRole('option', { name: 'A-01 · Allée A', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Destination', exact: true })).toHaveCount(0);
  await panel.getByRole('spinbutton', { name: 'Quantité (EA)', exact: true }).fill('4');
  await panel
    .getByRole('textbox', { name: 'Note du mouvement', exact: true })
    .fill('Rangement confirmé');
  return panel;
}
async function submit(page: Page) {
  await page.getByRole('button', { name: 'Vérifier le déplacement', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirmer le déplacement', exact: true });
  await expect(confirm).toContainText('4 EA de KIT : RC-01 → A-01');
  await confirm.getByRole('button', { name: 'Déplacer le stock', exact: true }).click();
}
async function pending(page: Page) {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('pulsar.wms.move.v1:'))
      .map((k) => JSON.parse(localStorage.getItem(k)!)),
  );
}
test('putaway is a site queue with separate units, inactive warnings and server paging', async ({
  page,
}) => {
  const state = await setup(page);
  await expect(page.getByRole('article', { name: 'À ranger KIT depuis RC-01' })).toContainText(
    '17 EA',
  );
  await expect(page.getByRole('article', { name: 'À ranger VRAC depuis RC-OFF' })).toContainText(
    '2.125 KG',
  );
  await expect(page.getByRole('button', { name: 'Ranger VRAC' })).toBeDisabled();
  await expect(page.getByText(/pas un lot de provenance ni une réservation/)).toBeVisible();
  await page.getByRole('button', { name: 'Suivante', exact: true }).click();
  await expect
    .poll(() =>
      state.requests.some(
        (u) => u.pathname.endsWith('/putaway') && u.searchParams.get('page') === '2',
      ),
    )
    .toBe(true);
  await page.getByRole('textbox', { name: 'Rechercher le stock à ranger' }).fill('KIT');
  await expect
    .poll(() =>
      state.requests.some(
        (u) => u.searchParams.get('q') === 'KIT' && u.searchParams.get('page') === '1',
      ),
    )
    .toBe(true);
  expect(state.writes).toHaveLength(0);
});
test('cancel never writes; success sends one complete keyed movement and refreshes', async ({
  page,
}) => {
  const state = await setup(page);
  const writes: any[] = [];
  await page.route('**/api/v1/wms/inventory/move', (r) => {
    writes.push(r.request().postDataJSON());
    state.rows[0].qtyOnHand = '13';
    return r.fulfill({
      json: { movementId: 'm1', replayed: false, createdAt: new Date().toISOString() },
    });
  });
  await form(page);
  await page.getByRole('button', { name: 'Vérifier le déplacement', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer le déplacement', exact: true })
    .getByRole('button', { name: 'Annuler', exact: true })
    .click();
  expect(writes).toHaveLength(0);
  expect(await pending(page)).toHaveLength(0);
  await submit(page);
  await expect(page.getByRole('dialog', { name: 'Ranger KIT', exact: true })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'À ranger KIT depuis RC-01' })).toContainText(
    '13 EA',
  );
  expect(writes).toEqual([
    {
      operationKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      itemId: 'ea',
      fromBinId: 'receiving',
      toBinId: 'storage',
      locationId: 'site-a',
      qty: 4,
      note: 'Rangement confirmé',
    },
  ]);
  expect(await pending(page)).toHaveLength(0);
});
test('known stock conflict retains draft and permits correction, with no pending recovery', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/wms/inventory/move', (r) =>
    r.fulfill({ status: 409, json: { message: 'Stock insuffisant test' } }),
  );
  const p = await form(page);
  await submit(page);
  await expect(p.getByText('Stock insuffisant test')).toBeVisible();
  await expect(p.getByRole('spinbutton', { name: 'Quantité (EA)' })).toHaveValue('4');
  await expect(
    p.getByRole('button', { name: 'Vérifier le déplacement', exact: true }),
  ).toBeEnabled();
  expect(await pending(page)).toHaveLength(0);
});
test('lost response survives reload and recovery reuses the exact original request', async ({
  page,
}) => {
  await setup(page);
  const writes: any[] = [];
  await page.route('**/api/v1/wms/inventory/move', (r) => {
    writes.push(r.request().postDataJSON());
    return writes.length === 1
      ? r.abort('failed')
      : r.fulfill({
          json: { movementId: 'm1', replayed: true, createdAt: new Date().toISOString() },
        });
  });
  const p = await form(page);
  await submit(page);
  await expect(p.getByText(/Résultat non confirmé/)).toBeVisible();
  await expect(
    p.getByRole('button', { name: 'Vérifier le déplacement', exact: true }),
  ).toBeDisabled();
  expect(await pending(page)).toHaveLength(1);
  await p.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page.reload();
  const banner = page.getByRole('complementary', { name: 'Déplacement à vérifier' });
  await expect(banner).toContainText('4 EA de KIT : RC-01 → A-01');
  await expect(page.getByRole('button', { name: 'Ranger KIT', exact: true })).toBeDisabled();
  await banner.getByRole('button', { name: 'Vérifier et reprendre' }).click();
  await page
    .getByRole('dialog', { name: 'Reprendre le déplacement' })
    .getByRole('button', { name: 'Vérifier et reprendre' })
    .click();
  await expect(banner).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(await pending(page)).toHaveLength(0);
  await page.reload();
  await expect(banner).toHaveCount(0);
});
test('failed recovery preserves the original operation instead of permitting a new one', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/wms/inventory/move', (r) => r.abort('failed'));
  const p = await form(page);
  await submit(page);
  await expect(p.getByText(/Résultat non confirmé/)).toBeVisible();
  await p.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  const original = await pending(page);
  await page
    .getByRole('complementary', { name: 'Déplacement à vérifier' })
    .getByRole('button', { name: 'Vérifier et reprendre' })
    .click();
  await page
    .getByRole('dialog', { name: 'Reprendre le déplacement' })
    .getByRole('button', { name: 'Vérifier et reprendre' })
    .click();
  await expect(page.getByText(/La demande reste conservée/)).toBeVisible();
  expect(await pending(page)).toEqual(original);
  await expect(page.getByRole('button', { name: 'Ranger KIT', exact: true })).toBeDisabled();
});
test('unavailable browser persistence prevents sending a stock write', async ({ page }) => {
  const state = await setup(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.startsWith('pulsar.wms.move.v1:')) throw new Error('quota');
      return original.call(this, k, v);
    };
  });
  const p = await form(page);
  await submit(page);
  await expect(p.getByText(/Aucun déplacement envoyé/)).toBeVisible();
  expect(state.writes).toHaveLength(0);
});
test('WMS reader can inspect putaway and history but cannot move stock', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pulsar.auth')!);
    s.user.permissions = ['wms.read'];
    s.tenant.enabledModules = ['wms'];
    localStorage.setItem('pulsar.auth', JSON.stringify(s));
  });
  await page.reload();
  await expect(page.getByRole('article', { name: 'À ranger KIT depuis RC-01' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Ranger / })).toHaveCount(0);
  await page.getByRole('link', { name: 'Journal des mouvements', exact: true }).last().click();
  await expect(page.getByRole('article', { name: 'Mouvement KIT' })).toBeVisible();
});
test('journal keeps dossier context while filtering and links actors, bins and source documents', async ({
  page,
}) => {
  const state = await setup(
    page,
    '/wms/movements?locationId=site-a&itemId=ea&binId=receiving&refId=receipt-a&refType=receipt',
  );
  await expect(page.getByRole('article', { name: 'Mouvement KIT' })).toContainText('Marie Roy');
  await expect(page.getByRole('link', { name: 'RC-200 ↗' })).toHaveAttribute(
    'href',
    '/wms/receiving/receipt-a',
  );
  await expect(page.getByRole('article', { name: 'Mouvement VRAC' })).toContainText(
    'Unité actuelle · historique non figé',
  );
  await page.getByRole('combobox', { name: 'Type de mouvement' }).selectOption('MOVE');
  await page.getByRole('textbox', { name: 'Rechercher un mouvement' }).fill('Allée');
  await expect
    .poll(() =>
      state.requests.some(
        (u) =>
          u.searchParams.get('type') === 'MOVE' &&
          u.searchParams.get('search') === 'Allée' &&
          u.searchParams.get('itemId') === 'ea' &&
          u.searchParams.get('binId') === 'receiving' &&
          u.searchParams.get('refId') === 'receipt-a' &&
          u.searchParams.get('locationId') === 'site-a',
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Suivante', exact: true }).click();
  await expect
    .poll(() =>
      state.requests.some(
        (u) => u.pathname.endsWith('/movements') && u.searchParams.get('page') === '2',
      ),
    )
    .toBe(true);
  expect(state.writes).toHaveLength(0);
});
test('putaway errors are not presented as an empty healthy warehouse', async ({ page }) => {
  const state = await setup(page);
  state.failPutaway();
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByText('Rangement indisponible test')).toBeVisible();
  await expect(page.getByText('Aucun stock en attente de rangement', { exact: true })).toHaveCount(
    0,
  );
});
test('journal errors are explicit and never turn into a fabricated empty history', async ({
  page,
}) => {
  const state = await setup(page, '/wms/movements');
  state.failJournal();
  await page.getByRole('button', { name: 'Actualiser le journal' }).click();
  await expect(page.getByText('Journal indisponible test')).toBeVisible();
  await expect(page.getByText('Aucun mouvement correspondant', { exact: true })).toHaveCount(0);
});
test('putaway drawer and movement journal remain contained on a phone', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const p = await form(page);
  await expect(
    p.getByRole('button', { name: 'Vérifier le déplacement', exact: true }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('putaway-mobile.png'), fullPage: true });
  await p.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page
    .getByRole('dialog', { name: 'Fermer le déplacement' })
    .getByRole('button', { name: 'Abandonner' })
    .click();
  await page.goto('/wms/movements');
  await expect(page.getByRole('article', { name: 'Mouvement KIT' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('journal-mobile.png'), fullPage: true });
});
