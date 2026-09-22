import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, readonly = false, legacy = false) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    ({ readonly }) =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'definitions-ui-fixture',
          refreshToken: '',
          user: {
            id: 'fixture',
            firstName: 'Test',
            lastName: 'MRP',
            email: 'test@example.test',
            permissions: [
              'manufacturing.read',
              'wms.read',
              ...(readonly ? [] : ['manufacturing.manage']),
            ],
          },
          tenant: {
            id: 'fixture',
            name: 'Atelier test',
            slug: 'fixture',
            enabledModules: ['manufacturing', 'wms'],
          },
        }),
      ),
    { readonly },
  );
  const state = { writes: [] as { path: string; body: any }[], fail: false };
  const revision = {
    id: 'rev1',
    revision: 1,
    outputSku: 'FG',
    outputUnit: 'EA',
    outputItemId: 'fg',
    createdAt: '2026-09-15T12:00:00Z',
    lines: [{ id: 'rl1', sku: 'RAW', name: 'Acier', quantityPerUnit: '0.125', unit: 'KG' }],
  };
  const bom = {
    id: 'bom',
    code: 'BOM-FG',
    name: 'Assemblage',
    productRef: 'FG',
    isActive: true,
    updatedAt: '2026-09-15T12:00:00Z',
    _count: { lines: 1 },
    lines: [{ id: 'l1', materialRef: 'RAW', materialName: 'Acier', quantityPerUnit: '0.125' }],
    revisions: [revision],
  };
  let order: any = {
    id: 'of',
    number: 'OF-001',
    name: 'Assemblage client',
    productRef: 'FG',
    quantity: 4,
    dueDate: '2026-10-15',
    releaseDate: '2026-09-15',
    priority: 'NORMAL',
    status: legacy ? 'RELEASED' : 'DRAFT',
    firmness: 'FIRM',
    updatedAt: bom.updatedAt,
    operations: [],
    bomId: 'bom',
    materialSnapshot: null,
  };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1/', '');
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON();
      state.writes.push({ path, body });
      if (state.fail)
        return route.fulfill({
          status: 409,
          json: { message: 'La nomenclature a changé. Rechargez avant de modifier.' },
        });
      if (path.endsWith('/material-context'))
        order = {
          ...order,
          locationId: 'site',
          location: { name: 'Montréal' },
          bomRevisionId: 'rev1',
          bomRevision: revision,
        };
      return route.fulfill({
        json: path.endsWith('/revisions') ? revision : path.includes('/orders/') ? order : bom,
      });
    }
    if (path === 'manufacturing/boms')
      return route.fulfill({ json: { items: [bom], total: 1, page: 1, pageSize: 50 } });
    if (path === 'manufacturing/boms/bom') return route.fulfill({ json: bom });
    if (path === 'manufacturing/boms/bom/revisions/rev1') return route.fulfill({ json: revision });
    if (path === 'wms/choices/items')
      return route.fulfill({
        json: {
          items: [
            { id: 'raw', sku: 'RAW', name: 'Acier', unit: 'KG' },
            { id: 'fg', sku: 'FG', name: 'Assemblage', unit: 'EA' },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    if (path === 'manufacturing/mrp/options')
      return route.fulfill({
        json: {
          locations: [{ id: 'site', code: 'MTL', name: 'Montréal' }],
          items: [
            { id: 'fg', sku: 'FG', name: 'Assemblage', unit: 'EA' },
            { id: 'raw', sku: 'RAW', name: 'Acier', unit: 'KG' },
          ],
          boms: [{ ...bom, revisions: [revision] }],
        },
      });
    if (path === 'manufacturing/orders/of') return route.fulfill({ json: order });
    if (path === 'manufacturing/work-centers' || path === 'manufacturing/routings')
      return route.fulfill({ json: { items: [], total: 0 } });
    return route.fulfill({ json: path === 'notifications' ? [] : {} });
  });
  return { errors, state };
}

test('BOM drawer preserves shell, explains units and publishes only after acknowledgement', async ({
  page,
}) => {
  const { errors, state } = await setup(page);
  await page.goto('/manufacturing/boms');
  const heading = page.getByRole('heading', { name: 'Nomenclatures', exact: true });
  const before = await heading.boundingBox();
  await page.getByRole('button', { name: 'BOM-FG', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect((await heading.boundingBox())?.y).toBe(before?.y);
  const publish = dialog.getByRole('button', { name: 'Publier le brouillon enregistré' });
  await expect(publish).toBeDisabled();
  await expect(dialog.getByText('× 0.125 KG', { exact: true })).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Je confirme/ }).check();
  await publish.click();
  await expect(dialog.getByText('Version 1 · lecture seule')).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body).toEqual({
    expectedUpdatedAt: '2026-09-15T12:00:00Z',
    acknowledgeUnits: true,
  });
  await page.screenshot({
    path: 'test-results/manufacturing-definitions-desktop.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('BOM sends exact decimal strings and preserves input on conflict', async ({ page }) => {
  const { state } = await setup(page);
  await page.goto('/manufacturing/boms');
  await page.getByRole('button', { name: 'BOM-FG', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Référence matière :/ }).click();
  const refPicker = page.getByRole('dialog', { name: 'Référence matière' });
  await expect(refPicker).toBeVisible();
  await refPicker.getByRole('option', { name: /Acier/ }).click();
  await expect(refPicker).toBeHidden();
  await dialog.getByLabel('Qté / unité').fill('0.123456789');
  state.fail = true;
  await dialog.getByRole('button', { name: 'Ajouter la ligne' }).click();
  await expect(dialog.getByRole('alert')).toContainText('La nomenclature a changé');
  await expect(dialog.getByLabel('Qté / unité')).toHaveValue('0.123456789');
  expect(state.writes[0].body.quantityPerUnit).toBe('0.123456789');
  expect(state.writes).toHaveLength(1);
});

test('read-only BOM exposes history without enabling edits', async ({ page }) => {
  const { state } = await setup(page, true);
  await page.goto('/manufacturing/boms');
  await expect(page.getByRole('button', { name: 'Nouvelle nomenclature' })).toHaveCount(0);
  await page.getByRole('button', { name: 'BOM-FG', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^v1/ }).click();
  await expect(dialog.getByText('Version 1 · lecture seule')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Enregistrer le brouillon' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Publier le brouillon enregistré' })).toHaveCount(
    0,
  );
  expect(state.writes).toHaveLength(0);
});

test('OF material context sends an explicit site, revision and optimistic version', async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  await page.goto('/manufacturing/orders/of');
  await page.getByRole('button', { name: 'Configurer les matières' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Site de fabrication').selectOption('site');
  await dialog.getByLabel('Nomenclature publiée').selectOption('rev1');
  await dialog.getByRole('button', { name: 'Enregistrer le contexte' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('v1 sélectionnée')).toBeVisible();
  expect(state.writes[0].body).toEqual({
    locationId: 'site',
    bomRevisionId: 'rev1',
    expectedUpdatedAt: '2026-09-15T12:00:00Z',
  });
  expect(errors).toEqual([]);
});

test('legacy OF never presents a reconstructed material history', async ({ page }) => {
  await setup(page, false, true);
  await page.goto('/manufacturing/orders/of');
  await expect(page.getByText(/Aucun instantané matières disponible/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Configurer les matières' })).toHaveCount(0);
});

test('material context drawer fits a narrow viewport', async ({ page }) => {
  const { errors } = await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/manufacturing/orders/of');
  await page.getByRole('button', { name: 'Configurer les matières' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      return !!box && box.x >= -1 && box.x + box.width <= 391;
    })
    .toBe(true);
  await page.screenshot({
    path: 'test-results/manufacturing-materials-mobile.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
