import { test, expect, type Page } from './fixtures';
import { login } from './helpers';
import type { WmsGuidedDocument } from '@pulsar/shared';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});
async function setup(page: Page, kind: 'receipt' | 'pick-order' = 'receipt') {
  await login(page);
  const location = { id: 'guided-site', code: 'NORD', name: 'Entrepôt Nord', type: 'WAREHOUSE' };
  const bin = {
    id: 'b1',
    code: 'R-01',
    zone: 'Réception',
    isActive: true,
    locationId: location.id,
  };
  const otherBin = { ...bin, id: 'b2', code: 'A-02', zone: 'Allée A' };
  const items = [
    { id: 'i1', sku: 'VIS', name: 'Visserie', unit: 'EA', isActive: true },
    { id: 'i2', sku: 'VRAC', name: 'Matière en vrac', unit: 'KG', isActive: true },
  ];
  const document: WmsGuidedDocument = {
    id: 'guided',
    number: kind === 'receipt' ? 'RC-582' : 'PK-682',
    status: kind === 'receipt' ? 'DRAFT' : 'OPEN',
    locationId: location.id,
    location,
    reference: 'Commande 874',
    note: 'Vérifier l’emballage.',
    createdAt: '2026-09-14T13:00:00Z',
    updatedAt: '2026-09-14T14:00:00.000Z',
    lines: items.map((item, index) => ({
      id: `line-${index}`,
      itemId: item.id,
      item,
      qty: index === 0 ? '3' : '1.25',
      ...(kind === 'receipt'
        ? { toBinId: bin.id, toBin: bin }
        : { fromBinId: bin.id, fromBin: bin }),
    })),
    readiness: {
      applicable: true,
      canExecute: true,
      blockedLines: 0,
      generatedAt: '2026-09-14T14:01:00Z',
      lines: items.map((item, index) => ({
        lineId: `line-${index}`,
        issues: [],
        requiredFromBin: index === 0 ? '3' : '1.25',
        stockOnHand: kind === 'receipt' ? null : '8',
        shortage: kind === 'receipt' ? null : '0',
      })),
    },
  };
  const endpoint = kind === 'receipt' ? 'receipts' : 'pick-orders';
  await page.route('**/api/v1/wms/**', (r) => {
    const url = new URL(r.request().url()),
      path = url.pathname.replace('/api/v1/wms/', '');
    if (r.request().method() !== 'GET')
      return r.fulfill({ status: 500, json: { message: 'Écriture non prévue.' } });
    if (path === `${endpoint}/guided`) return r.fulfill({ json: document });
    if (path.startsWith('items/'))
      return r.fulfill({ json: { ...items.find((i) => path.endsWith(i.id)), lotTracked: false } });
    if (path === 'choices/items')
      return r.fulfill({
        json: {
          items: items.map((i) => ({ ...i, name: `${i.sku} — ${i.name} · ${i.unit}` })),
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    if (path.startsWith('choices/items/')) {
      const item = items.find((i) => path.endsWith(i.id))!;
      return r.fulfill({ json: { ...item, name: `${item.sku} — ${item.name} · ${item.unit}` } });
    }
    if (path === `sites/${location.id}/bins`)
      return r.fulfill({
        json: {
          items: [bin, otherBin].map((b) => ({ ...b, name: `${b.code} · ${b.zone}` })),
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    if (path.startsWith(`sites/${location.id}/bins/`)) {
      const selected = path.endsWith('b2') ? otherBin : bin;
      return r.fulfill({ json: { ...selected, name: `${selected.code} · ${selected.zone}` } });
    }
    if (path === 'inventory')
      return r.fulfill({
        json: [
          {
            itemId: url.searchParams.get('itemId'),
            binId: url.searchParams.get('binId'),
            qtyOnHand: '8',
          },
        ],
      });
    return r.fulfill({ status: 404, json: { message: 'Introuvable' } });
  });
  await page.route('**/api/v1/yard/dossiers/related/**', (r) =>
    r.fulfill({ json: { items: [], truncated: false } }),
  );
  await page.goto(kind === 'receipt' ? '/wms/receiving/guided' : '/wms/picking/guided');
  await expect(
    page.getByRole('heading', {
      name: `${kind === 'receipt' ? 'Réception' : 'Préparation'} ${document.number}`,
      exact: true,
    }),
  ).toBeVisible();
  return { document, endpoint, items, bin, otherBin };
}

for (const kind of ['receipt', 'pick-order'] as const) {
  test(`${kind}: guided quantities and confirmation always cover the whole document`, async ({
    page,
  }) => {
    const { document, endpoint } = await setup(page, kind);
    const action = kind === 'receipt' ? 'Valider la réception' : 'Finaliser la préparation';
    let writes = 0;
    await page.route(
      `**/api/v1/wms/${endpoint}/guided/${kind === 'receipt' ? 'post' : 'complete'}`,
      (r) => {
        expect(r.request().postDataJSON()).toEqual({ expectedUpdatedAt: document.updatedAt });
        writes++;
        document.status = kind === 'receipt' ? 'POSTED' : 'COMPLETED';
        document.readiness.applicable = false;
        document.readiness.canExecute = false;
        document.readiness.lines.forEach((c) => {
          c.stockOnHand = null;
        });
        return r.fulfill({ json: document });
      },
    );
    await expect(page.getByRole('article', { name: 'Ligne VRAC' })).toContainText('1.25 KG');
    await page.getByRole('textbox', { name: 'Filtrer les lignes du document' }).fill('VIS');
    await page.getByRole('button', { name: action }).click();
    const confirmation = page.getByRole('dialog', { name: 'Confirmer le stock' });
    await expect(confirmation).toContainText('2 ligne(s)');
    await expect(confirmation).toContainText('pas seulement les lignes affichées');
    await confirmation.getByRole('button', { name: 'Annuler', exact: true }).click();
    expect(writes).toBe(0);
    await page.getByRole('button', { name: action }).click();
    await confirmation.getByRole('button', { name: 'Confirmer', exact: true }).click();
    await expect(page.getByRole('button', { name: action })).toHaveCount(0);
    expect(writes).toBe(1);
  });

  test(`${kind}: line correction uses a panel, retains failed input and saves the versioned line`, async ({
    page,
  }) => {
    const { document, endpoint, otherBin } = await setup(page, kind);
    let failed = true,
      writes = 0;
    await page.route(`**/api/v1/wms/${endpoint}/guided/lines/line-0`, (r) => {
      const b = r.request().postDataJSON();
      expect(b).toEqual({
        itemId: 'i1',
        [kind === 'receipt' ? 'toBinId' : 'fromBinId']: 'b2',
        qty: 4,
        expectedUpdatedAt: document.updatedAt,
      });
      writes++;
      if (failed)
        return r.fulfill({ status: 409, json: { message: 'Emplacement momentanément bloqué.' } });
      document.lines[0].qty = '4';
      if (kind === 'receipt') {
        document.lines[0].toBin = otherBin;
        document.lines[0].toBinId = 'b2';
      } else {
        document.lines[0].fromBin = otherBin;
        document.lines[0].fromBinId = 'b2';
      }
      return r.fulfill({ json: document });
    });
    await page.getByRole('button', { name: 'Modifier VIS', exact: true }).click();
    const p = page.getByRole('dialog', { name: 'Modifier la ligne', exact: true });
    await p.getByRole('spinbutton', { name: 'Quantité (EA)' }).fill('4');
    await p.getByRole('button', { name: /^Emplacement :/ }).click();
    await page
      .getByRole('dialog', { name: 'Emplacement', exact: true })
      .getByRole('option', { name: 'A-02 · Allée A', exact: true })
      .click();
    await p.getByRole('button', { name: 'Enregistrer la ligne' }).click();
    await expect(p.getByRole('alert')).toContainText('bloqué');
    await page.keyboard.press('Escape');
    await page
      .getByRole('dialog', { name: 'Fermer la ligne' })
      .getByRole('button', { name: 'Annuler' })
      .click();
    await expect(p.getByRole('spinbutton', { name: 'Quantité (EA)' })).toHaveValue('4');
    failed = false;
    await p.getByRole('button', { name: 'Enregistrer la ligne' }).click();
    await expect(p).toBeHidden();
    await expect(page.getByRole('article', { name: 'Ligne VIS' })).toContainText('4 EA');
    await expect(page.getByRole('article', { name: 'Ligne VIS' })).toContainText('A-02');
    expect(writes).toBe(2);
  });
}

test('short stock is a line-level blocker with the combined demand, never a false reservation', async ({
  page,
}) => {
  const { document } = await setup(page, 'pick-order');
  document.readiness.canExecute = false;
  document.readiness.blockedLines = 1;
  document.readiness.lines[0] = {
    lineId: 'line-0',
    issues: ['Stock insuffisant pour les lignes de ce dossier'],
    stockOnHand: '8',
    requiredFromBin: '10',
    shortage: '2',
  };
  await page.getByRole('button', { name: 'Actualiser le dossier' }).click();
  await expect(page.getByRole('article', { name: 'Ligne VIS' })).toContainText('Manque 2 EA');
  await expect(page.getByRole('button', { name: 'Finaliser la préparation' })).toBeDisabled();
  await expect(page.getByRole('complementary', { name: 'Vérification et contexte' })).toContainText(
    'ne réserve aucun stock',
  );
});

test('add-line search is server-backed and has no stock side effect', async ({ page }) => {
  const { document, bin } = await setup(page);
  let writes = 0;
  await page.route('**/api/v1/wms/receipts/guided/lines', (r) => {
    writes++;
    expect(r.request().postDataJSON()).toEqual({
      itemId: 'i1',
      toBinId: 'b1',
      qty: 0.125,
      expectedUpdatedAt: document.updatedAt,
    });
    document.lines.push({ ...document.lines[0], id: 'new', qty: '0.125', toBin: bin });
    return r.fulfill({ json: document });
  });
  await page.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click();
  const p = page.getByRole('dialog', { name: 'Ajouter une ligne', exact: true });
  await p.getByRole('button', { name: /^Article :/ }).click();
  const picker = page.getByRole('dialog', { name: 'Article', exact: true });
  const request = page.waitForRequest(
    (r) =>
      r.url().includes('/choices/items?') && new URL(r.url()).searchParams.get('search') === 'VIS',
  );
  await picker.getByRole('textbox', { name: 'Rechercher : article' }).fill('VIS');
  await request;
  await picker.getByRole('option', { name: 'VIS — Visserie · EA', exact: true }).click();
  await p.getByRole('button', { name: /^Emplacement :/ }).click();
  await page
    .getByRole('dialog', { name: 'Emplacement', exact: true })
    .getByRole('option', { name: 'R-01 · Réception', exact: true })
    .click();
  await p.getByRole('spinbutton', { name: 'Quantité (EA)' }).fill('0.125');
  await expect(p).toContainText('ne modifie aucun stock');
  await p.getByRole('button', { name: 'Enregistrer la ligne' }).click();
  await expect(p).toBeHidden();
  expect(writes).toBe(1);
  await expect(page.getByRole('article', { name: 'Ligne VIS' })).toHaveCount(2);
});

test('line removal confirms and failure never removes the row from the screen', async ({
  page,
}) => {
  const { document } = await setup(page);
  let writes = 0;
  await page.route('**/api/v1/wms/receipts/guided/lines/line-0?**', (r) => {
    expect(new URL(r.request().url()).searchParams.get('expectedUpdatedAt')).toBe(
      document.updatedAt,
    );
    writes++;
    return r.fulfill({ status: 409, json: { message: 'Document modifié par un collègue.' } });
  });
  await page.getByRole('button', { name: 'Retirer VIS', exact: true }).click();
  const c = page.getByRole('dialog', { name: 'Retirer la ligne' });
  await c.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Retirer VIS', exact: true }).click();
  await c.getByRole('button', { name: 'Retirer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('collègue');
  await expect(page.getByRole('article', { name: 'Ligne VIS' })).toBeVisible();
});

test('unknown line-write result prevents retry and asks to inspect the document', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/wms/receipts/guided/lines/line-0', (r) => r.abort('failed'));
  await page.getByRole('button', { name: 'Modifier VIS' }).click();
  const p = page.getByRole('dialog', { name: 'Modifier la ligne' });
  await p.getByRole('button', { name: 'Enregistrer la ligne' }).click();
  await expect(p.getByRole('alert')).toContainText('peut-être été enregistrée');
  await expect(p.getByRole('button', { name: 'Enregistrer la ligne' })).toHaveCount(0);
  await p.getByRole('button', { name: 'Fermer et actualiser' }).click();
  await expect(p).toBeHidden();
});

test('pending line write prevents closing, editing and duplicate submission', async ({ page }) => {
  const { document } = await setup(page);
  let writes = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/wms/receipts/guided/lines/line-0', async (r) => {
    writes++;
    await pending;
    await r.fulfill({ json: document });
  });
  await page.getByRole('button', { name: 'Modifier VIS' }).click();
  const p = page.getByRole('dialog', { name: 'Modifier la ligne' });
  await p.getByRole('button', { name: 'Enregistrer la ligne' }).click();
  await expect.poll(() => writes).toBe(1);
  await expect(p.getByRole('spinbutton', { name: 'Quantité (EA)' })).toBeDisabled();
  await expect(p.getByRole('button', { name: 'Enregistrer la ligne' })).toBeDisabled();
  const closeButtons = p.getByRole('button', { name: 'Fermer', exact: true });
  await expect(closeButtons).toHaveCount(2);
  for (const close of await closeButtons.all()) await expect(close).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(p).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Fermer la ligne' })).toHaveCount(0);
  release();
  await expect(p).toBeHidden();
  expect(writes).toBe(1);
});

test('lost finalization response requires refresh and never replays the stock operation', async ({
  page,
}) => {
  const { document } = await setup(page, 'pick-order');
  let writes = 0;
  await page.route('**/api/v1/wms/pick-orders/guided/complete', (r) => {
    writes++;
    document.status = 'COMPLETED';
    document.readiness.applicable = false;
    document.readiness.canExecute = false;
    return r.abort('failed');
  });
  await page.getByRole('button', { name: 'Finaliser la préparation' }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer le stock' })
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('peut-être réussi');
  await expect(page.getByRole('button', { name: 'Finaliser la préparation' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toBeDisabled();
  await page.getByRole('button', { name: 'Actualiser le dossier' }).click();
  await expect(page.getByRole('heading', { name: 'Opération enregistrée' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finaliser la préparation' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Ligne VIS' })).toContainText('Quantité validée');
  expect(writes).toBe(1);
});

test('WMS-only reader sees the dossier without any mutation buttons', async ({ page }) => {
  await setup(page, 'pick-order');
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pulsar.auth')!);
    s.user.permissions = ['wms.read'];
    s.tenant.enabledModules = ['wms'];
    localStorage.setItem('pulsar.auth', JSON.stringify(s));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Préparation PK-682' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Modifier VIS' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finaliser la préparation' })).toHaveCount(0);
});

test('missing readiness fails closed and refresh recovers', async ({ page }) => {
  const { document } = await setup(page);
  const readiness = document.readiness;
  document.readiness = undefined as any;
  await page.getByRole('button', { name: 'Actualiser le dossier' }).click();
  await expect(page.getByRole('alert')).toContainText('Contrôle indisponible');
  await expect(page.getByRole('button', { name: 'Valider la réception' })).toBeDisabled();
  document.readiness = readiness;
  await page.getByRole('button', { name: 'Actualiser le dossier' }).click();
  await expect(page.getByRole('button', { name: 'Valider la réception' })).toBeEnabled();
});

test('guided document and line editor remain contained on mobile', async ({ page }) => {
  await setup(page, 'pick-order');
  await page.screenshot({ path: 'playwright-artifacts/wms-guided-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'playwright-artifacts/wms-guided-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Finaliser la préparation' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Finaliser la préparation' })).toBeVisible();
  await page.screenshot({
    path: 'playwright-artifacts/wms-guided-mobile-actions.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Modifier VIS' }).click();
  const p = page.getByRole('dialog', { name: 'Modifier la ligne' });
  await expect(p.getByRole('spinbutton', { name: 'Quantité (EA)' })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Emplacement : R-01 · Réception' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: 'playwright-artifacts/wms-guided-line-mobile.png',
    fullPage: true,
  });
});
