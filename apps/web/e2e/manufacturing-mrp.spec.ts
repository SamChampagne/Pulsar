import { test, expect, type Page } from '@playwright/test';

async function setup(
  page: Page,
  readonly = false,
  empty = false,
  crm = false,
  salesOrderId = '',
  ai = false,
  mapped = false,
) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ readonly, crm, ai }) =>
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
              ...(crm ? ['crm.read'] : []),
              ...(readonly ? [] : ['manufacturing.manage']),
              ...(ai
                ? [
                    'core.operating.tasks.read',
                    'core.operating.tasks.manage',
                    'core.agents.read',
                    'core.agents.manage',
                    'core.agents.actions.read',
                  ]
                : []),
            ],
          },
          tenant: {
            id: 'fixture',
            name: 'Atelier test',
            slug: 'fixture',
            enabledModules: ['manufacturing', 'wms', ...(crm ? ['crm'] : [])],
          },
        }),
      ),
    { readonly, crm, ai },
  );
  const state = {
    writes: [] as { path: string; body: any }[],
    reads: [] as string[],
    fail: false,
    stale: false,
    reviewed: false,
  };
  const mapping = {
    id: 'mapping1',
    productId: 'product1',
    itemId: 'fg',
    numerator: '12',
    denominator: '1',
    commercialUnit: 'boîte',
    unitSnapshot: 'EA',
    isActive: true,
    updatedAt: '2026-09-15T12:00:00Z',
    product: { name: 'Carton assemblages' },
    item: { sku: 'ASSEMBLAGE' },
  };
  const assistance = () => ({
    stale: state.stale,
    task: state.writes.some((w) => w.path.endsWith('request-review'))
      ? { id: 'task', status: 'OPEN', assigneeAgentId: null }
      : null,
    event: null,
    workers: [],
    runs: [],
    proposals: [],
    reviews: state.reviewed
      ? [
          {
            id: 'review1',
            summary: 'Vérifier la disponibilité de l’acier. <script>unsafe</script>',
            itemIds: ['raw'],
            staleAtReview: true,
            createdAt: '2026-09-15T12:00:00Z',
            agentId: 'agent1',
          },
        ]
      : [],
  });
  const forecast = {
    id: 'f1',
    locationId: 'site',
    itemId: 'fg',
    kind: 'FORECAST',
    quantity: '100',
    reference: 'Assemblages octobre',
    forecastStart: '2026-10-01',
    dueDate: '2026-10-31',
    isActive: true,
    updatedAt: '2026-09-15T00:00:00Z',
  };
  const coverage = {
    forecastId: 'f1',
    itemId: 'fg',
    reference: forecast.reference,
    quantity: '100',
    consumed: '30',
    remaining: '70',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    orders: [],
  };
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
    locationId: 'site',
    createdAt: '2026-09-15T12:00:00Z',
    horizonEnd: '2026-10-15',
    proposalCount: 2,
    exceptionCount: 0,
    result,
    ...(crm ? { sourceMetadata: { forecastCoverage: [coverage] } } : {}),
  };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1/', '');
    if (route.request().method() === 'GET') state.reads.push(route.request().url());
    if (route.request().method() !== 'GET') {
      state.writes.push({ path, body: route.request().postDataJSON() });
      if (state.fail)
        return route.fulfill({
          status: 409,
          json: { message: 'Ces données ont changé. Rechargez avant de les modifier.' },
        });
      if (path.endsWith('request-review')) return route.fulfill({ json: assistance() });
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
          entries: crm ? [forecast] : [],
          coverage: { forecasts: crm ? [coverage] : [] },
          receipts: [],
          runs: empty ? [] : [run],
        },
      });
    if (path === 'manufacturing/mrp/sales-sources')
      return route.fulfill({
        json: {
          items: [
            {
              id: 'line1',
              productId: mapped ? 'product1' : null,
              name: 'Assemblage client',
              quantity: mapped ? '2.5' : '30',
              updatedAt: '2026-09-15T09:00:00Z',
              salesOrder: {
                id: 'so1',
                number: 'SO-001',
                status: 'CONFIRMED',
                updatedAt: '2026-09-15T10:00:00Z',
              },
              mrpDemands: [],
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      });
    if (path.endsWith('/assistance')) return route.fulfill({ json: assistance() });
    if (path === 'agents/control-tower')
      return route.fulfill({ json: { items: [], rollup: null } });
    if (path === 'manufacturing/mrp/product-mappings')
      return route.fulfill({ json: { items: mapped ? [mapping] : [], total: mapped ? 1 : 0 } });
    if (path === 'crm/products')
      return route.fulfill({
        json: { items: [{ id: 'product1', name: 'Carton assemblages', sku: 'BOX' }], total: 1 },
      });
    if (path === 'manufacturing/mrp/runs/run')
      return route.fulfill({
        json: { ...run, stale: state.stale, staleReason: 'Les données ont changé. Recalculer.' },
      });
    return route.fulfill({ json: path === 'notifications' ? [] : {} });
  });
  await page.goto(`/manufacturing/mrp${salesOrderId ? `?salesOrderId=${salesOrderId}` : ''}`);
  await expect(page.getByRole('heading', { name: 'Besoins matières', exact: true })).toBeVisible();
  return { state, errors };
}

test('MRP role registration includes its worker category and restricted tool allowlist', async ({
  page,
}) => {
  const { state, errors } = await setup(page, false, false, false, '', true);
  await page.goto('/agents');
  await page.getByRole('button', { name: 'Nouvel agent' }).click();
  await page.getByRole('button', { name: /Analyste MRP \(worker\)/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Fabrication et WMS en lecture/)).toBeVisible();
  await dialog.getByLabel('Nom', { exact: true }).fill('Analyste matières');
  await dialog.getByRole('button', { name: "Créer l'agent", exact: true }).click();
  await expect.poll(() => state.writes.filter((w) => w.path === 'agents').length).toBe(1);
  const body = state.writes.find((w) => w.path === 'agents')!.body;
  expect(body.autonomyLevel).toBe('PROPOSE');
  expect(body.caps).toMatchObject({ alwaysOn: true, handlesCategories: ['MRP_REVIEW'] });
  expect(body.caps.toolAllowlist).toContain('submit_mrp_review');
  expect(body.caps.toolAllowlist).not.toContain('resolve_task');
  expect(body.permissions).toContain('crm.read');
  expect(errors).toEqual([]);
});

test('commercial mapping previews exact quantities and sends the captured mapping version', async ({
  page,
}) => {
  const { state, errors } = await setup(page, false, false, true, '', false, true);
  await page.getByRole('button', { name: /^Demande/ }).click();
  await page.getByRole('button', { name: 'Relier une commande client' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Ligne de commande confirmée', exact: true })
    .selectOption('line1');
  await dialog.getByRole('button', { name: 'Utiliser cette correspondance' }).click();
  await expect(dialog.getByText('2.5 boîte → 30 EA', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('combobox', { name: 'Article WMS à fournir', exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel('Date du besoin (UTC)').fill('2026-10-12');
  await dialog.getByLabel(/Je confirme le ratio/).check();
  await page.screenshot({ path: 'test-results/mrp-commercial-ratio.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Confirmer le rattachement' }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes[0].body).toMatchObject({
    mappingId: 'mapping1',
    expectedMappingUpdatedAt: '2026-09-15T12:00:00Z',
    itemId: 'fg',
  });
  expect(state.writes[0].body).not.toHaveProperty('quantity');
  expect(errors).toEqual([]);
});

test('mapping configuration remains a Pulsar drawer and versions edits', async ({ page }) => {
  const { state, errors } = await setup(page, false, false, true, '', false, true);
  await page.getByRole('button', { name: /^Demande/ }).click();
  const before = await page
    .getByRole('heading', { name: 'Besoins matières', exact: true })
    .boundingBox();
  await page.getByRole('button', { name: 'Produits et unités' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('1 boîte = 12 EA', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Modifier le ratio' }).click();
  await dialog.getByLabel('Équivalent WMS (EA)').fill('24');
  await dialog.getByLabel(/Je confirme ce produit/).check();
  await dialog.getByRole('button', { name: 'Enregistrer la correspondance' }).click();
  await expect(dialog.getByRole('button', { name: 'Nouvelle correspondance' })).toBeVisible();
  expect(state.writes[0].body).toMatchObject({
    numerator: '24',
    denominator: '1',
    expectedUpdatedAt: '2026-09-15T12:00:00Z',
  });
  expect(
    (await page.getByRole('heading', { name: 'Besoins matières', exact: true }).boundingBox())?.y,
  ).toBe(before?.y);
  expect(errors).toEqual([]);
});

test('MRP assistance shows truthful stages and links an approved review to its source item', async ({
  page,
}) => {
  const { state, errors } = await setup(page, false, false, true, '', true);
  await expect(page.getByRole('heading', { name: 'Couverture par article' })).toBeVisible();
  await page.getByText('Assistance IA du calcul', { exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Assistance MRP' })).toBeVisible();
  await expect(page.getByText('Aucune synthèse', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Demander une revue IA' }).click();
  await expect(page.getByText('À traiter', { exact: true })).toBeVisible();
  await expect(page.getByText('Aucune exécution', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Demander une revue IA' })).toHaveCount(0);
  state.reviewed = true;
  await page.getByRole('button', { name: 'Actualiser le suivi IA' }).click();
  await expect(
    page.getByText('Vérifier la disponibilité de l’acier. <script>unsafe</script>', {
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/mrp-ai-assistance-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Voir l’article cité 1' }).click();
  await expect(
    page.getByRole('dialog').getByText('0.5 KG à acheter', { exact: true }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('MRP assistance handles uncertain requests and fits a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, errors } = await setup(page, false, false, false, '', true);
  await page.getByText('Assistance IA du calcul', { exact: false }).click();
  state.fail = true;
  await page.getByRole('button', { name: 'Demander une revue IA' }).click();
  await expect(page.getByRole('button', { name: 'Demander une revue IA' })).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Actualisez le suivi');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/mrp-ai-assistance-mobile.png', fullPage: true });
  expect(state.writes).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('forecast keeps an explicit period and displays firm consumption without double counting', async ({
  page,
}) => {
  const { state, errors } = await setup(page, false, false, true);
  await page.getByText('Prévisions retenues dans ce calcul', { exact: true }).click();
  await expect(
    page.getByText('100 prévu · 30 remplacé · 70 restant EA', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Prévisions/ }).click();
  await expect(page.getByText('70 restant', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Couverture Assemblages octobre' }),
  ).toHaveAttribute('value', '30');
  await page.screenshot({ path: 'test-results/mrp-forecast-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Ajouter une prévision' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Article WMS', exact: true }).selectOption('fg');
  await dialog.getByLabel('Quantité (EA)').fill('100.125');
  await dialog.getByLabel('Début de période (UTC)').fill('2026-10-01');
  await dialog.getByLabel('Fin de période (UTC)').fill('2026-10-31');
  await dialog.getByLabel('Référence métier').fill('Prévision octobre');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes[0].body).toMatchObject({
    kind: 'FORECAST',
    quantity: '100.125',
    forecastStart: '2026-10-01',
    dueDate: '2026-10-31',
  });
  expect(errors).toEqual([]);
});

async function fillSalesDemand(page: Page) {
  await page.getByRole('button', { name: 'Relier une commande client' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ligne de commande confirmée').selectOption('line1');
  await dialog.getByLabel('Article WMS à fournir').selectOption('fg');
  await dialog.getByLabel('Date du besoin (UTC)').fill('2026-10-12');
  await dialog.getByLabel('Prévision remplacée (facultatif)').selectOption('f1');
  await expect(dialog.getByRole('button', { name: 'Confirmer le rattachement' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /Je confirme/ }).check();
  return dialog;
}

test('CRM deep link imports authoritative quantity with explicit units and source versions', async ({
  page,
}) => {
  const { state, errors } = await setup(page, false, false, true, 'so1');
  const header = page.getByRole('heading', { name: 'Besoins matières', exact: true });
  const before = await header.boundingBox();
  const dialog = await fillSalesDemand(page);
  expect((await header.boundingBox())?.y).toBe(before?.y);
  await expect(dialog.getByText(/30 unités commerciales/)).toBeVisible();
  expect(
    state.reads.some((url) => url.includes('sales-sources') && url.includes('salesOrderId=so1')),
  ).toBe(true);
  await dialog.getByRole('button', { name: 'Confirmer le rattachement' }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.writes[0]).toEqual({
    path: 'manufacturing/mrp/sales-demands',
    body: {
      locationId: 'site',
      itemId: 'fg',
      sourceSalesOrderLineId: 'line1',
      dueDate: '2026-10-12',
      forecastId: 'f1',
      isActive: true,
      acknowledgeUnits: true,
      expectedSourceUpdatedAt: '2026-09-15T09:00:00Z',
      expectedOrderUpdatedAt: '2026-09-15T10:00:00Z',
    },
  });
  expect(errors).toEqual([]);
});

test('CRM drawer remains usable on narrow screens and prevents resending after conflict', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, errors } = await setup(page, false, false, true, 'so1');
  const dialog = await fillSalesDemand(page);
  state.fail = true;
  await dialog.getByRole('button', { name: 'Confirmer le rattachement' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Ces données ont changé');
  await expect(dialog.getByRole('button', { name: 'Confirmer le rattachement' })).toBeDisabled();
  await expect(dialog.getByLabel('Date du besoin (UTC)')).toHaveValue('2026-10-12');
  await expect(dialog).toHaveCSS('opacity', '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/mrp-sales-demand-mobile.png', fullPage: true });
  expect(state.writes).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('CRM entry points require CRM access and manufacturing management', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: /^Demande/ }).click();
  await expect(page.getByRole('button', { name: 'Relier une commande client' })).toHaveCount(0);
  await page.unroute('**/api/v1/**');
  await setup(page, true, false, true);
  await page.getByRole('button', { name: /^Demande/ }).click();
  await expect(page.getByRole('button', { name: 'Relier une commande client' })).toHaveCount(0);
});

async function preparationFixture(
  page: Page,
  options: { readonly?: boolean; stale?: boolean; lose?: boolean; commitBeforeLoss?: boolean } = {},
) {
  const base = await setup(page, options.readonly);
  let document: any = null;
  const confirmations: any[] = [];
  await page.route('**/manufacturing/mrp/runs/run/preparation?*', (route) =>
    route.fulfill({
      json: {
        proposal: {
          id: 'raw:2026-09-20',
          item_id: 'raw',
          method: 'BUY',
          quantity: '0.5',
          release_date: '2026-09-18',
          receipt_date: '2026-09-20',
        },
        item: { sku: 'ACIER', name: 'Acier de structure', unit: 'KG' },
        site: { name: 'Montréal' },
        revision: null,
        existing: document,
        reviewToken: 'a'.repeat(64),
        canPrepare: !options.stale && !document,
        blockers: options.stale
          ? ['Le calcul est périmé. Recalculez avant de préparer un document.']
          : [],
        notice: 'Demande interne uniquement. Aucun fournisseur contacté ni mouvement de stock.',
      },
    }),
  );
  await page.route('**/manufacturing/mrp/runs/run/prepare', async (route) => {
    confirmations.push(route.request().postDataJSON());
    if (!options.lose || confirmations.length > 1 || options.commitBeforeLoss)
      document = {
        id: 'prepared',
        number: 'MR-000001',
        method: 'BUY',
        status: 'DRAFT',
        manufacturingOrderId: null,
        manufacturingOrder: null,
        updatedAt: '2026-09-15T15:00:00Z',
      };
    if (options.lose && confirmations.length === 1) return route.abort('failed');
    return route.fulfill({ json: document });
  });
  await page.route('**/manufacturing/mrp/preparations/prepared/cancel', (route) => {
    document = { ...document, status: 'CANCELLED' };
    return route.fulfill({ json: document });
  });
  async function open() {
    await page.getByRole('button', { name: 'Expliquer ACIER' }).click();
    await page.getByRole('button', { name: 'Préparer / voir le document' }).click();
    await expect(page.getByRole('dialog', { name: 'Préparer un document MRP' })).toBeVisible();
    await expect(
      page.getByRole('dialog').getByText('Demande d’achat interne', { exact: true }),
    ).toBeVisible();
  }
  await open();
  return { ...base, confirmations, open };
}

test('preparation needs explicit confirmation, shows the durable request and guards cancellation', async ({
  page,
}) => {
  const { confirmations, errors } = await preparationFixture(page);
  const dialog = page.getByRole('dialog', { name: 'Préparer un document MRP' });
  const create = dialog.getByRole('button', { name: 'Créer le brouillon confirmé' });
  await expect(create).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /Je confirme la quantité/ }).check();
  await create.click();
  await expect(dialog.getByText('MR-000001', { exact: true })).toBeVisible();
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0].operationKey).toMatch(/^[a-f0-9-]{36}$/);
  expect(confirmations[0]).not.toHaveProperty('quantity');
  await expect(dialog.getByRole('button', { name: 'Annuler la demande' })).toBeDisabled();
  await dialog.getByLabel(/Je confirme l’annulation/).check();
  await dialog.getByRole('button', { name: 'Annuler la demande' }).click();
  await expect(dialog.getByRole('region', { name: 'Document préparé' })).toContainText('Annulé');
  await page.screenshot({ path: 'test-results/mrp-preparation-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('preparation resumes the exact persisted confirmation after a network loss and reload', async ({
  page,
}) => {
  const { confirmations, open, errors } = await preparationFixture(page, { lose: true });
  await page.getByRole('checkbox', { name: /Je confirme la quantité/ }).check();
  await page.getByRole('button', { name: 'Créer le brouillon confirmé' }).click();
  await expect(page.getByRole('button', { name: 'Reprendre la même confirmation' })).toBeVisible();
  await page.reload();
  await open();
  await page.getByRole('button', { name: 'Reprendre la même confirmation' }).click();
  await expect(page.getByText('MR-000001', { exact: true })).toBeVisible();
  expect(confirmations).toHaveLength(2);
  expect(confirmations[1]).toEqual(confirmations[0]);
  expect(errors).toEqual([]);
});

test('lost successful response is resolved by reading the existing document without another write', async ({
  page,
}) => {
  const { confirmations, open } = await preparationFixture(page, {
    lose: true,
    commitBeforeLoss: true,
  });
  await page.getByRole('checkbox', { name: /Je confirme la quantité/ }).check();
  await page.getByRole('button', { name: 'Créer le brouillon confirmé' }).click();
  await expect(page.getByRole('button', { name: 'Reprendre la même confirmation' })).toBeVisible();
  await page.reload();
  await open();
  await expect(page.getByText('MR-000001', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reprendre la même confirmation' })).toHaveCount(0);
  expect(confirmations).toHaveLength(1);
});

test('stale preparation is blocked on mobile without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { confirmations, errors } = await preparationFixture(page, { stale: true });
  await expect(page.getByRole('button', { name: 'Créer le brouillon confirmé' })).toBeDisabled();
  await expect(page.getByText(/Le calcul est périmé/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Préparer un document MRP' })).toHaveCSS(
    'opacity',
    '1',
  );
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/mrp-preparation-mobile.png', fullPage: true });
  expect(confirmations).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('read-only users can inspect a preparation but cannot create or cancel', async ({ page }) => {
  const { confirmations, errors } = await preparationFixture(page, { readonly: true });
  await expect(page.getByRole('button', { name: 'Créer le brouillon confirmé' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Annuler la demande' })).toHaveCount(0);
  expect(confirmations).toHaveLength(0);
  expect(errors).toEqual([]);
});

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
