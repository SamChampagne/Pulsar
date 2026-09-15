import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';
import type { WmsWorkspace, WmsBinDetail } from '@pulsar/shared';

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    throw error;
  });
});

async function setup(page: Page) {
  await login(page);
  const site = { id: 'warehouse-a', code: 'LAV', name: 'Centre Laval', type: 'WAREHOUSE' as const };
  const otherSite = {
    id: 'warehouse-b',
    code: 'LEV',
    name: 'Centre Lévis',
    type: 'WAREHOUSE' as const,
  };
  const bins = [
    {
      id: 'receiving',
      code: 'RC-01',
      zone: 'Quai nord',
      kind: 'RECEIVING',
      isActive: true,
      stockedItems: 2,
      negativeItems: 0,
    },
    {
      id: 'storage',
      code: 'A-01',
      zone: 'Allée A',
      kind: 'STORAGE',
      isActive: true,
      stockedItems: 0,
      negativeItems: 0,
    },
    {
      id: 'inactive',
      code: 'OFF',
      zone: null,
      kind: 'SHIPPING',
      isActive: false,
      stockedItems: 1,
      negativeItems: 0,
    },
  ];
  const receipt = {
    id: 'receipt',
    number: 'RC-874',
    status: 'DRAFT',
    reference: 'Commande 482',
    createdAt: '2026-09-14T14:00:00Z',
    lineCount: 2,
  };
  const workspace: WmsWorkspace = {
    site,
    generatedAt: '2026-09-14T15:00:00Z',
    bins: { items: bins, total: 3, page: 1, pageSize: 80 },
    summary: { bins: 3, stockedBins: 2, inactiveBins: 1, negativeLevels: 0, cycleCounts: 1 },
    receiving: { items: [receipt], total: 1 },
    putaway: { items: [bins[0]], total: 1 },
    picking: { items: [{ ...receipt, id: 'pick', number: 'PK-674', status: 'OPEN' }], total: 1 },
    finishing: { items: [], total: 0 },
  };
  const detail: WmsBinDetail = {
    bin: { ...bins[0], locationId: site.id, updatedAt: '2026-09-14T15:00:00Z' },
    levels: {
      items: [
        {
          itemId: 'item-ea',
          sku: 'VIS',
          name: 'Visserie',
          unit: 'EA',
          qtyOnHand: '17',
          isActive: true,
        },
        {
          itemId: 'item-kg',
          sku: 'VRAC',
          name: 'Matière en vrac',
          unit: 'KG',
          qtyOnHand: '2.125',
          isActive: true,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 50,
    },
  };
  await page.route('**/api/v1/wms/**', (r) => {
    const url = new URL(r.request().url()),
      path = url.pathname.replace('/api/v1/wms/', '');
    if (r.request().method() !== 'GET')
      return r.fulfill({ status: 500, json: { message: 'Mutation non prévue dans ce test.' } });
    if (path === 'sites')
      return r.fulfill({ json: { items: [site, otherSite], total: 2, page: 1, pageSize: 100 } });
    if (path.startsWith('sites/'))
      return r.fulfill({ json: path.endsWith(otherSite.id) ? otherSite : site });
    if (path === 'workspace')
      return r.fulfill({
        json:
          url.searchParams.get('locationId') === otherSite.id
            ? {
                ...workspace,
                site: otherSite,
                bins: { ...workspace.bins, items: [], total: 0 },
                putaway: { items: [], total: 0 },
                receiving: { items: [], total: 0 },
                picking: { items: [], total: 0 },
                summary: {
                  bins: 0,
                  stockedBins: 0,
                  inactiveBins: 0,
                  negativeLevels: 0,
                  cycleCounts: 0,
                },
              }
            : workspace,
      });
    if (path === 'workspace/bins/receiving') return r.fulfill({ json: detail });
    if (path === 'workspace/bins/inactive')
      return r.fulfill({ json: { ...detail, bin: { ...detail.bin, ...bins[2] } } });
    if (path === 'bins')
      return r.fulfill({ json: bins.map((b) => ({ ...b, locationId: site.id })) });
    if (path === 'items')
      return r.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 100 } });
    if (path === 'receipts/receipt')
      return r.fulfill({
        json: { ...receipt, locationId: site.id, lines: [], _count: { lines: 0 } },
      });
    return r.fulfill({ json: [] });
  });
  await page.route('**/api/v1/yard/dossiers/related/**', (r) =>
    r.fulfill({ json: { items: [], truncated: false } }),
  );
  await page.goto('/wms');
  await expect(
    page.getByRole('heading', { name: 'Le travail à faire', exact: true }),
  ).toBeVisible();
  return { workspace, detail, bins, site, otherSite };
}
async function panel(page: Page) {
  await page.getByRole('button', { name: 'Emplacement RC-01 — Avec stock', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Emplacement RC-01', exact: true });
  await expect(panel.getByRole('heading', { name: 'Stock sur place', exact: true })).toBeVisible();
  return panel;
}
async function moveForm(page: Page) {
  const p = await panel(page);
  await p.getByRole('button', { name: 'Déplacer VIS', exact: true }).click();
  await p
    .getByRole('combobox', { name: 'Emplacement de destination', exact: true })
    .selectOption('storage');
  await p.getByRole('spinbutton', { name: 'Quantité (EA)', exact: true }).fill('4');
  return p;
}
test('schematic shows operational zones and real queues, not a mixed-unit quantity or fake capacity', async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByRole('heading', { name: 'Entrepôt', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Emplacement OFF — Inactif', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Quantité totale en stock', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^RC-874 ↗/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cour & quais ↗', exact: true })).toHaveAttribute(
    'href',
    '/yard?site=warehouse-a',
  );
  const p = await panel(page);
  await expect(p.getByText('17 EA', { exact: true })).toBeVisible();
  await expect(p.getByText('2.125 KG', { exact: true })).toBeVisible();
});
test('confirmed stock movement retains the current site, cancel does nothing and success refreshes', async ({
  page,
}) => {
  const { detail } = await setup(page);
  let writes = 0;
  await page.route('**/api/v1/wms/inventory/move', (r) => {
    writes++;
    expect(r.request().postDataJSON()).toEqual({
      itemId: 'item-ea',
      fromBinId: 'receiving',
      toBinId: 'storage',
      locationId: 'warehouse-a',
      qty: 4,
    });
    detail.levels.items[0].qtyOnHand = '13';
    return r.fulfill({ json: {} });
  });
  const p = await moveForm(page);
  await expect(p.getByRole('option', { name: /OFF/ })).toHaveCount(0);
  await p.getByRole('button', { name: 'Vérifier le déplacement' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirmer le déplacement', exact: true });
  await expect(confirm).toContainText('Aucun dossier');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toBe(0);
  await p.getByRole('button', { name: 'Vérifier le déplacement' }).click();
  await confirm.getByRole('button', { name: 'Déplacer le stock', exact: true }).click();
  await expect(p).toBeHidden();
  expect(writes).toBe(1);
  await expect((await panel(page)).getByText('13 EA', { exact: true })).toBeVisible();
});
test('rejected movement preserves the selection and quantity', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/wms/inventory/move', (r) =>
    r.fulfill({ status: 409, json: { message: 'Stock utilisé par un autre opérateur.' } }),
  );
  const p = await moveForm(page);
  await p.getByRole('button', { name: 'Vérifier le déplacement' }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer le déplacement' })
    .getByRole('button', { name: 'Déplacer le stock' })
    .click();
  await expect(p.getByRole('alert')).toContainText('autre opérateur');
  await expect(p.getByRole('spinbutton', { name: 'Quantité (EA)' })).toHaveValue('4');
  await expect(p.getByRole('combobox', { name: 'Emplacement de destination' })).toHaveValue(
    'storage',
  );
});
test('uncertain stock response cannot be retried and requires a fresh inspection', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/wms/inventory/move', (r) => r.abort('failed'));
  const p = await moveForm(page);
  await p.getByRole('button', { name: 'Vérifier le déplacement' }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer le déplacement' })
    .getByRole('button', { name: 'Déplacer le stock' })
    .click();
  await expect(p.getByRole('alert')).toContainText('peut-être été déplacé');
  await expect(p.getByRole('button', { name: 'Vérifier le déplacement' })).toBeDisabled();
  await p.getByRole('button', { name: 'Fermer et actualiser' }).click();
  await expect(p).toBeHidden();
});
test('zone save sends only display metadata and a version; stale save keeps the draft', async ({
  page,
}) => {
  await setup(page);
  let writes = 0;
  await page.route('**/api/v1/wms/bins/receiving', (r) => {
    writes++;
    expect(r.request().postDataJSON()).toEqual({
      zone: 'Réserve froide',
      expectedUpdatedAt: '2026-09-14T15:00:00Z',
    });
    return r.fulfill({ status: 409, json: { message: 'Zone modifiée par un autre opérateur.' } });
  });
  const p = await panel(page);
  await p.getByRole('button', { name: 'Organiser la zone' }).click();
  await p.getByRole('textbox', { name: 'Zone d’affichage', exact: true }).fill('Réserve froide');
  await p.getByRole('button', { name: 'Enregistrer la zone' }).click();
  await expect(p.getByRole('alert')).toContainText('autre opérateur');
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Fermer l’emplacement' })
    .getByRole('button', { name: 'Annuler' })
    .click();
  await expect(p.getByRole('textbox', { name: 'Zone d’affichage' })).toHaveValue('Réserve froide');
  expect(writes).toBe(1);
});
test('a WMS-only reader can inspect stock without configuration or movement actions', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('pulsar.auth')!);
    s.user.permissions = ['wms.read'];
    s.tenant.enabledModules = ['wms'];
    localStorage.setItem('pulsar.auth', JSON.stringify(s));
  });
  await page.reload();
  await expect(page.getByRole('link', { name: 'Cour & quais ↗' })).toHaveCount(0);
  const p = await panel(page);
  await expect(p.getByRole('button', { name: 'Organiser la zone' })).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Déplacer VIS' })).toHaveCount(0);
  await expect(p.getByText('17 EA', { exact: true })).toBeVisible();
});
test('workspace failure is explicit and retry recovers rather than showing a healthy empty site', async ({
  page,
}) => {
  const { workspace } = await setup(page);
  await page.route('**/api/v1/wms/workspace?**', (r) =>
    r.fulfill({ status: 503, json: { message: 'Lecture indisponible.' } }),
  );
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Lecture indisponible');
  await expect(page.getByText('Rien en attente.', { exact: true })).toHaveCount(0);
  await page.route('**/api/v1/wms/workspace?**', (r) => r.fulfill({ json: workspace }));
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Emplacement RC-01 — Avec stock' })).toBeVisible();
});
test('warehouse selection and empty-site setup never reuse the other site stock', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Entrepôt : Centre Laval', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Entrepôt', exact: true })
    .getByRole('button', { name: 'Centre Lévis', exact: true })
    .click();
  await expect(page.getByText('Aucun emplacement configuré', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Emplacement RC-01 — Avec stock' })).toHaveCount(0);
});
test('receipt navigation returns to the warehouse workspace through its related dossier', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('link', { name: /^RC-874 ↗/ }).click();
  await expect(page).toHaveURL(/\/wms\/receiving\/receipt$/);
  await page.getByRole('link', { name: 'LAV — Centre Laval', exact: true }).click();
  await expect(page).toHaveURL(/\/wms\?site=warehouse-a$/);
  await expect(page.getByRole('heading', { name: 'Le travail à faire' })).toBeVisible();
});
test('schematic and bin drawer stay contained on phone and desktop', async ({ page }) => {
  await setup(page);
  await page.screenshot({ path: 'playwright-artifacts/wms-workspace-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'playwright-artifacts/wms-workspace-mobile.png', fullPage: true });
  const p = await panel(page);
  await expect(p.getByText('17 EA', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'playwright-artifacts/wms-bin-mobile.png', fullPage: true });
  await p.getByRole('button', { name: 'Déplacer VIS', exact: true }).click();
  await expect(p.getByRole('combobox', { name: 'Emplacement de destination' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'playwright-artifacts/wms-move-mobile.png', fullPage: true });
});

test('zone success refreshes the schematic and survives reopening the panel', async ({ page }) => {
  const { workspace, detail } = await setup(page);
  await page.route('**/api/v1/wms/bins/receiving', (r) => {
    detail.bin.zone = r.request().postDataJSON().zone;
    workspace.bins.items[0].zone = detail.bin.zone;
    return r.fulfill({ json: {} });
  });
  const p = await panel(page);
  await p.getByRole('button', { name: 'Organiser la zone' }).click();
  await p.getByRole('textbox', { name: 'Zone d’affichage' }).fill('Réserve froide');
  await p.getByRole('button', { name: 'Enregistrer la zone' }).click();
  await expect(p).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Réserve froide Réception' })).toBeVisible();
  await expect(await panel(page)).toContainText('Réserve froide');
});

test('a pending stock write cannot be closed or submitted a second time', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route('**/api/v1/wms/inventory/move', async (r) => {
    writes++;
    await pending;
    await r.fulfill({ json: {} });
  });
  const p = await moveForm(page);
  await p.getByRole('button', { name: 'Vérifier le déplacement' }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer le déplacement' })
    .getByRole('button', { name: 'Déplacer le stock' })
    .click();
  try {
    await expect.poll(() => writes).toBe(1);
    await page.keyboard.press('Escape');
    await expect(p).toBeVisible();
    await expect(p.getByRole('button', { name: 'Vérifier le déplacement' })).toBeDisabled();
    await expect(p.getByRole('button', { name: 'Fermer', exact: true }).last()).toBeDisabled();
  } finally {
    release();
  }
  await expect(p).toBeHidden();
  expect(writes).toBe(1);
});

test('pagination and search use the server; the site totals stay intact', async ({ page }) => {
  const { workspace } = await setup(page);
  await page.route('**/api/v1/wms/workspace?**', (r) => {
    const params = new URL(r.request().url()).searchParams;
    const pageNumber = Number(params.get('page')) || 1;
    const searching = !!params.get('q');
    if (searching) expect(pageNumber).toBe(1);
    return r.fulfill({
      json: {
        ...workspace,
        summary: { ...workspace.summary, bins: 81 },
        bins: {
          items:
            searching || pageNumber === 2
              ? [{ ...workspace.bins.items[1], code: 'Z-081' }]
              : workspace.bins.items,
          page: pageNumber,
          pageSize: 80,
          total: searching ? 1 : 81,
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Pages des emplacements' })
    .getByRole('button', { name: 'Suivante' })
    .click();
  await expect(page.getByRole('button', { name: 'Emplacement Z-081 — Sans stock' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Rechercher un emplacement ou une zone' }).fill('Z-081');
  await expect(page.getByRole('navigation', { name: 'Pages des emplacements' })).toBeHidden();
  await expect(page.getByLabel('État du site')).toContainText('81');
});

test('a bin deep link from another site never exposes an actionable stock panel', async ({
  page,
}) => {
  const { detail } = await setup(page);
  await page.route('**/api/v1/wms/workspace/bins/receiving?**', (r) =>
    r.fulfill({ json: { ...detail, bin: { ...detail.bin, locationId: 'warehouse-b' } } }),
  );
  await page.goto('/wms?site=warehouse-a&bin=receiving');
  const p = page.getByRole('dialog', { name: 'Emplacement', exact: true });
  await expect(p.getByRole('alert')).toContainText('autre site');
  await expect(p.getByRole('button', { name: 'Déplacer VIS' })).toHaveCount(0);
});
