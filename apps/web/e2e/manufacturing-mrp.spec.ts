import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page, readonly = false, empty = false) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ readonly }) =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'mrp-ui-fixture',
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
  const state = { writes: [] as { path: string; body: any }[], fail: false, stale: false };
  const result = {
    as_of: '2026-09-15',
    horizon_end: '2026-10-15',
    items: [
      {
        item_id: 'fg',
        sku: 'ASSEMBLAGE',
        name: 'Assemblage final',
        unit: 'EA',
        method: 'MAKE',
        level: 0,
        on_hand: '2',
        gross_requirement: '5',
        planned_receipts: '3',
        projected_end: '0',
        timeline: [],
      },
      {
        item_id: 'raw',
        sku: 'ACIER',
        name: 'Acier de structure',
        unit: 'KG',
        method: 'BUY',
        level: 1,
        on_hand: '1',
        gross_requirement: '1.5',
        planned_receipts: '0.5',
        projected_end: '0',
        timeline: [
          {
            date: '2026-09-20',
            gross: '1.5',
            scheduled_receipts: '0',
            planned_receipts: '0.5',
            projected: '0',
          },
        ],
      },
    ],
    proposals: [
      {
        id: 'fg:2026-09-22',
        item_id: 'fg',
        method: 'MAKE',
        quantity: '3',
        net_requirement: '3',
        receipt_date: '2026-09-22',
        release_date: '2026-09-20',
        expedite: false,
        level: 0,
        safety_stock: '0',
        reasons: [{ source: 'd1', reference: 'Client Alpha', quantity: '5', date: '2026-09-22' }],
      },
      {
        id: 'raw:2026-09-20',
        item_id: 'raw',
        method: 'BUY',
        quantity: '0.5',
        net_requirement: '0.5',
        receipt_date: '2026-09-20',
        release_date: '2026-09-18',
        expedite: false,
        level: 1,
        safety_stock: '0',
        reasons: [
          {
            source: 'fg:2026-09-22',
            reference: 'ASSEMBLAGE · 2026-09-22',
            quantity: '1.5',
            date: '2026-09-20',
          },
        ],
      },
    ],
    exceptions: [],
    assumptions: [],
  };
  const run = {
    id: 'run',
    createdAt: '2026-09-15T12:00:00Z',
    horizonEnd: '2026-10-15',
    proposalCount: 2,
    exceptionCount: 0,
    result,
  };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1/', '');
    if (route.request().method() !== 'GET') {
      state.writes.push({ path, body: route.request().postDataJSON() });
      if (state.fail)
        return route.fulfill({
          status: 409,
          json: { message: 'Ces données ont changé. Rechargez avant de les modifier.' },
        });
      return route.fulfill({ json: { ...run, stale: false } });
    }
    if (path === 'manufacturing/mrp/options')
      return route.fulfill({
        json: {
          locations: [{ id: 'site', name: 'Montréal', code: 'MTL' }],
          items: [
            { id: 'fg', sku: 'ASSEMBLAGE', name: 'Assemblage final', unit: 'EA' },
            { id: 'raw', sku: 'ACIER', name: 'Acier de structure', unit: 'KG' },
          ],
          boms: [
            {
              id: 'bom',
              code: 'BOM-FG',
              name: 'Assemblage',
              productRef: 'ASSEMBLAGE',
              revisions: [{ id: 'rev1', revision: 1, outputItemId: 'fg', outputUnit: 'EA' }],
            },
          ],
        },
      });
    if (path === 'manufacturing/mrp/workspace')
      return route.fulfill({
        json: {
          policies: empty
            ? []
            : [
                {
                  id: 'p1',
                  itemId: 'fg',
                  locationId: 'site',
                  method: 'MAKE',
                  bomId: 'bom',
                  bomRevisionId: 'rev1',
                  leadDays: 2,
                  safetyStock: '0',
                  minimumOrder: '0',
                  orderMultiple: '1',
                  updatedAt: '2026-09-15T00:00:00Z',
                },
              ],
          entries: [],
          receipts: [],
          runs: empty ? [] : [run],
        },
      });
    if (path === 'manufacturing/mrp/runs/run')
      return route.fulfill({
        json: { ...run, stale: state.stale, staleReason: 'Les données ont changé. Recalculer.' },
      });
    return route.fulfill({ json: path === 'notifications' ? [] : {} });
  });
  await page.goto('/manufacturing/mrp');
  await expect(page.getByRole('heading', { name: 'Besoins matières', exact: true })).toBeVisible();
  return { state, errors };
}

test('explains net requirements and navigates to the parent demand', async ({ page }) => {
  const { errors } = await setup(page);
  await page.getByRole('button', { name: 'Expliquer ACIER' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('0.5 KG à acheter', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'ASSEMBLAGE · 2026-09-22' }).click();
  await expect(dialog.getByText('Client Alpha', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.screenshot({ path: 'test-results/mrp-workspace-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('policy drawer does not shift the shell and preserves optimistic version', async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  await page.getByRole('button', { name: /Règles articles/ }).click();
  const header = page.getByRole('heading', { name: 'Besoins matières', exact: true });
  const before = await header.boundingBox();
  await page.getByRole('button', { name: 'Configurer ASSEMBLAGE' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect((await header.boundingBox())?.y).toBe(before?.y);
  await dialog.getByLabel(/Je confirme/).check();
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes[0].body.expectedUpdatedAt).toBe('2026-09-15T00:00:00Z');
  expect(state.writes[0].body.acknowledgeUnits).toBe(true);
  expect(state.writes[0].body.orderMultiple).toBe('1');
  expect(state.writes[0].body.bomRevisionId).toBe('rev1');
  expect(errors).toEqual([]);
});

test('new demand sends decimal strings and reports conflict without losing the form', async ({
  page,
}) => {
  const { state } = await setup(page);
  await page.getByRole('button', { name: /^Demande/ }).click();
  await page.getByRole('button', { name: 'Ajouter un besoin' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Article WMS').selectOption('raw');
  await dialog.getByLabel('Quantité (KG)').fill('0.125');
  await dialog.getByLabel('Référence métier').fill('Prévision septembre');
  state.fail = true;
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ces données ont changé');
  await expect(dialog.getByLabel('Quantité (KG)')).toHaveValue('0.125');
  expect(state.writes[0].body.quantity).toBe('0.125');
  expect(state.writes).toHaveLength(1);
});

test('read-only user can inspect but cannot calculate or configure', async ({ page }) => {
  await setup(page, true);
  await expect(page.getByRole('button', { name: 'Expliquer ACIER' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calculer les besoins' })).toHaveCount(0);
  await page.getByRole('button', { name: /Règles articles/ }).click();
  await expect(page.getByRole('button', { name: 'Règle article', exact: true })).toHaveCount(0);
});

test('empty workspace explains required setup', async ({ page }) => {
  await setup(page, false, true);
  await expect(
    page.getByRole('heading', { name: 'Préparez votre premier plan matières' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Calculer les besoins' })).toBeDisabled();
});

test('mobile drawer and workspace fit the viewport; stale run is explicit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, errors } = await setup(page);
  state.stale = true;
  await page.getByRole('button', { name: 'Actualiser le poste MRP' }).click();
  await expect(page.getByText('Calcul à actualiser', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(-15)
      .map((el) => ({
        tag: el.tagName,
        cls: el.className,
        width: el.getBoundingClientRect().width,
        right: el.getBoundingClientRect().right,
        position: getComputedStyle(el).position,
        parent: el.parentElement?.className,
        overflow: el.parentElement ? getComputedStyle(el.parentElement).overflow : '',
      })),
  }));
  await page.screenshot({ path: 'test-results/mrp-mobile-page.png', fullPage: true });
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  await page.getByRole('button', { name: 'Expliquer ACIER' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox();
      return Boolean(box && box.x >= -1 && box.x + box.width <= 391);
    })
    .toBe(true);
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/mrp-workspace-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
