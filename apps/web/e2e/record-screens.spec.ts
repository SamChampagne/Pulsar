import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/yard/dossiers/related/**', (r) =>
    r.fulfill({ json: { items: [], truncated: false } }),
  );
});

// UI-only error injection: all record mutations below are intercepted. Real
// CRM -> TMS integration remains covered by fulfillment.spec.ts.
const line = {
  id: 'line-ui',
  name: 'Transport palette',
  quantity: 2,
  unitPrice: 125,
  discountPct: 0,
  productId: null,
};
const company = { id: 'company-ui', name: 'Entreprise de test' };
const sale = {
  id: 'record-ui',
  number: 'SO-UI',
  status: 'DRAFT',
  totalAmount: 250,
  currency: 'CAD',
  companyId: company.id,
  company,
  customerId: 'customer-ui',
  dealId: null,
  notes: null,
};
const deal = {
  id: 'record-ui',
  title: 'Corridor de test',
  stage: 'QUALIFIED',
  amount: 250,
  currency: 'CAD',
  companyId: company.id,
  company,
  pipelineStage: { id: 'stage-ui', name: 'Validation technique' },
};
const transport = {
  id: 'record-ui',
  orderNumber: 'TO-UI',
  status: 'PLANNED',
  mode: 'FTL',
  customer: { id: 'customer-ui', name: 'Entreprise de test', code: 'UI' },
  originLocation: { id: 'origin-ui', name: 'Entrepôt', city: 'Québec' },
  destinationLocation: { id: 'dest-ui', name: 'Client', city: 'Montréal' },
  shipments: [],
  createdAt: '2026-09-14T12:00:00Z',
};
const load = {
  id: 'record-ui',
  loadNumber: 'LD-UI',
  status: 'OPEN',
  mode: 'FTL',
  carrier: null,
  driver: null,
  vehicle: null,
  trailer: null,
  rate: null,
  shipments: [],
  route: null,
  accessorials: [],
  costDetail: null,
  estimatedCost: null,
  costCurrency: null,
};

async function mockCrm(page: Page, kind: 'deals' | 'sales-orders', status = 'DRAFT') {
  const record = kind === 'deals' ? deal : { ...sale, status };
  await page.route(`**/api/v1/crm/${kind}/record-ui`, (r) => r.fulfill({ json: record }));
  await page.route(`**/api/v1/crm/${kind}/record-ui/line-items`, (r) =>
    r.fulfill({ json: [line] }),
  );
  await page.route(
    '**/api/v1/transportation/transport-orders/from-sales-order/record-ui/context',
    (r) => r.fulfill({ json: { canPrepareShipment: status === 'CONFIRMED', transportOrders: [] } }),
  );
}

for (const kind of ['deals', 'sales-orders'] as const) {
  test(`${kind}: inline editing retains the draft on failure and submits only once`, async ({
    page,
  }) => {
    await login(page);
    await mockCrm(page, kind);
    let writes = 0;
    await page.route(`**/api/v1/crm/${kind}/record-ui/line-items/line-ui`, async (r) => {
      writes++;
      expect(r.request().postDataJSON()).toEqual({ quantity: 2.5 });
      await r.fulfill(
        writes === 1
          ? { status: 503, json: { message: 'Erreur simulée, réessayez.' } }
          : { json: { ...line, quantity: 2.5 } },
      );
    });
    await page.goto(`/crm/${kind}/record-ui`);
    await page
      .getByRole('button', { name: 'Modifier quantité · Transport palette', exact: true })
      .click();
    const input = page.getByRole('spinbutton', {
      name: 'Quantité · Transport palette',
      exact: true,
    });
    await expect(input).toBeFocused();
    await input.fill('2.5');
    await input.press('Enter');
    await expect(page.getByText('Erreur simulée, réessayez.')).toBeVisible();
    await expect(input).toHaveValue('2.5');
    expect(writes).toBe(1);
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    expect(writes).toBe(2);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });
}

test('CRM add drawer preserves the page, searches active products, and protects a draft', async ({
  page,
}) => {
  await login(page);
  await mockCrm(page, 'deals');
  const searches: URL[] = [];
  await page.route('**/api/v1/crm/products**', (r) => {
    const url = new URL(r.request().url());
    searches.push(url);
    return r.fulfill({
      json: url.pathname.endsWith('/products')
        ? { items: [{ id: 'product-ui', name: 'Palette spéciale' }], total: 1 }
        : { id: 'product-ui', name: 'Palette spéciale' },
    });
  });
  await page.goto('/crm/deals/record-ui');
  const open = page.getByRole('button', { name: 'Ajouter une ligne', exact: true });
  const before = (await page.locator('#record-lines').boundingBox())!;
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'Ajouter une ligne', exact: true });
  expect(
    Math.abs((await page.locator('#record-lines').boundingBox())!.width - before.width),
  ).toBeLessThan(2);
  await drawer.getByRole('button', { name: 'Produit : Sélectionner…' }).click();
  const picker = page.getByRole('dialog', { name: 'Produit', exact: true });
  await picker.getByLabel('Rechercher : produit').fill('Palette');
  await picker.getByRole('button', { name: 'Palette spéciale', exact: true }).click();
  await expect(picker).toHaveCount(0);
  expect(
    searches.some(
      (u) => u.searchParams.get('active') === 'true' && u.searchParams.get('search') === 'Palette',
    ),
  ).toBe(true);
  await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Saisie non enregistrée', exact: true });
  await confirmation.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Produit : Palette spéciale' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Fermer', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Abandonner', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('confirmed sales order is read-only, with visible and retryable fulfillment failure', async ({
  page,
}) => {
  await login(page);
  await mockCrm(page, 'sales-orders', 'CONFIRMED');
  await page.route(
    '**/api/v1/transportation/transport-orders/from-sales-order/record-ui/context',
    (r) => r.fulfill({ status: 503, json: { message: 'offline' } }),
  );
  await page.goto('/crm/sales-orders/record-ui');
  await expect(page.getByText(/Lecture seule/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter une ligne' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Modifier quantité/ })).toHaveCount(0);
  await expect(
    page.getByText('Les expéditions liées sont temporairement indisponibles.'),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Expédition', exact: true })
      .getByRole('button', { name: 'Réessayer' }),
  ).toBeVisible();
});

test('transport drawer retains only unsubmitted rows after a partial failure', async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/transportation/transport-orders/record-ui', (r) =>
    r.fulfill({ json: transport }),
  );
  await page.route('**/api/v1/transportation/custom-fields**', (r) => r.fulfill({ json: [] }));
  const weights: number[] = [];
  await page.route('**/api/v1/transportation/transport-orders/record-ui/shipments', (r) => {
    weights.push(r.request().postDataJSON().weightKg);
    return r.fulfill(
      weights.length === 2
        ? { status: 409, json: { message: 'Deuxième ligne refusée' } }
        : { json: { id: `sh-${weights.length}` } },
    );
  });
  await page.goto('/transport-orders/record-ui');
  const before = (await page.locator('#record-shipments').boundingBox())!;
  await page.getByRole('button', { name: 'Ajouter une expédition…' }).click();
  const drawer = page.getByRole('dialog', { name: 'Ajouter des expéditions' });
  await expect(drawer).toBeVisible();
  expect(
    Math.abs((await page.locator('#record-shipments').boundingBox())!.y - before.y),
  ).toBeLessThan(2);
  await drawer.getByLabel('Poids (kg)').fill('100');
  await drawer.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click();
  await drawer.getByLabel('Poids (kg)').nth(1).fill('200');
  await drawer.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(drawer.getByText(/1 expédition\(s\) créée\(s\)/)).toBeVisible();
  await expect(drawer.getByLabel('Poids (kg)')).toHaveCount(1);
  await expect(drawer.getByLabel('Poids (kg)')).toHaveValue('200');
  await drawer.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(weights).toEqual([100, 200, 200]);
});

test('load errors are scoped to their section and a core failure can be retried', async ({
  page,
}) => {
  await login(page);
  let reads = 0;
  await page.route('**/api/v1/transportation/loads/record-ui', (r) =>
    r.fulfill(
      ++reads === 1
        ? { status: 503, json: { message: 'Chargement indisponible' } }
        : { json: load },
    ),
  );
  await page.route('**/api/v1/transportation/loads/record-ui/documents', (r) =>
    r.fulfill({ status: 503, json: { message: 'offline' } }),
  );
  await page.route('**/api/v1/transportation/loads/record-ui/tenders', (r) =>
    r.fulfill({ json: [] }),
  );
  await page.route('**/api/v1/transportation/tracking/events**', (r) =>
    r.fulfill({ status: 503, json: { message: 'offline' } }),
  );
  await page.goto('/loads/record-ui');
  await expect(page.getByText('Chargement indisponible', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'LD-UI', exact: true })).toBeVisible();
  await expect(
    page.locator('#record-documents').getByText('Documents indisponibles'),
  ).toBeVisible();
  await expect(page.locator('#record-tracking').getByText(/Suivi indisponible/)).toBeVisible();
  await expect(
    page.locator('#record-tracking').getByText(/No tracking|Aucun événement/),
  ).toHaveCount(0);
});

test('record navigation focuses its target and remains usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await mockCrm(page, 'deals');
  await page.goto('/crm/deals/record-ui');
  const nav = page.getByRole('navigation', { name: 'Sections du dossier' });
  await nav.getByRole('link', { name: 'Informations', exact: true }).press('Enter');
  await expect(page.locator('#record-info')).toBeFocused();
  await expect(nav.getByRole('link', { name: 'Informations', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await expect(nav).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Ajouter une ligne', exact: true });
  expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(390.01);
  await page.screenshot({ path: 'playwright-artifacts/records/phone-line-drawer.png' });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('free line keeps its fields on failure and accepts the API decimal / zero-price contract', async ({
  page,
}) => {
  await login(page);
  await mockCrm(page, 'sales-orders');
  let writes = 0;
  await page.route('**/api/v1/crm/sales-orders/record-ui/line-items', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: [line] });
    writes++;
    expect(r.request().postDataJSON()).toEqual({
      name: 'Échantillon',
      quantity: 0.5,
      unitPrice: 0,
    });
    await r.fulfill(
      writes === 1
        ? { status: 503, json: { message: 'Ajout temporairement indisponible' } }
        : { json: { ...line, name: 'Échantillon' } },
    );
  });
  await page.goto('/crm/sales-orders/record-ui');
  await page.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Ajouter une ligne', exact: true });
  await drawer.getByRole('button', { name: 'Ligne libre' }).click();
  await drawer.getByLabel('Libellé', { exact: true }).fill('Échantillon');
  await drawer.getByLabel('Quantité', { exact: true }).fill('0.5');
  await drawer.getByRole('button', { name: 'Ajouter la ligne', exact: true }).click();
  await expect(drawer.getByText('Ajout temporairement indisponible')).toBeVisible();
  await expect(drawer.getByLabel('Libellé', { exact: true })).toHaveValue('Échantillon');
  await expect(drawer.getByLabel('Quantité', { exact: true })).toHaveValue('0.5');
  await drawer.getByRole('button', { name: 'Ajouter la ligne', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(writes).toBe(2);
});

test('cancelling a line deletion never calls the mutation endpoint', async ({ page }) => {
  await login(page);
  await mockCrm(page, 'deals');
  let writes = 0;
  await page.route('**/api/v1/crm/deals/record-ui/line-items/line-ui', (r) => {
    writes++;
    return r.fulfill({ status: 204 });
  });
  await page.goto('/crm/deals/record-ui');
  await page.getByRole('button', { name: 'Supprimer Transport palette' }).click();
  const confirm = page.getByRole('dialog', { name: 'Supprimer une ligne' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(writes).toBe(0);
  await expect(
    page.getByRole('rowheader', { name: 'Transport palette', exact: true }),
  ).toBeVisible();
});
