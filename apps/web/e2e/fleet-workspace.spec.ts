import { test, expect, type Page } from './fixtures';
import { login } from './helpers';

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});
async function setup(page: Page, readonly = false) {
  await login(page);
  if (readonly)
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('pulsar.auth')!);
      s.user.permissions = ['fleet.read'];
      s.tenant.enabledModules = ['fleet'];
      localStorage.setItem('pulsar.auth', JSON.stringify(s));
    });
  const asset = {
    id: 'v1',
    kind: 'vehicle',
    unitNumber: 'TR-101',
    plate: 'ABC123',
    type: 'TRACTOR',
    status: 'MAINTENANCE',
    internal: true,
    openOrders: 1,
    expiredDocuments: 1,
    expiringDocuments: 0,
  };
  const order = {
    id: 'wo1',
    description: 'Inspection des freins',
    type: 'INSPECTION',
    status: 'OPEN',
    dueDate: '2026-09-16T00:00:00Z',
    vendor: 'Atelier local',
    openedAt: '2026-09-14T12:00:00Z',
    completedAt: null,
    updatedAt: '2026-09-14T12:00:00Z',
    costAmount: null,
    costCurrency: 'CAD',
    odometerKm: null,
    vehicle: { id: asset.id, unitNumber: asset.unitNumber, status: asset.status },
    trailer: null,
  };
  const state = {
    failure: 0,
    fieldsFailure: false,
    workspaceFailure: false,
    writes: [] as { path: string; method: string; body: any }[],
    queries: [] as string[],
    order,
    delay: 0,
  };
  await page.route('**/api/v1/fleet/**', async (r) => {
    const req = r.request(),
      url = new URL(req.url()),
      path = url.pathname.replace('/api/v1/fleet/', '');
    if (req.method() !== 'GET') {
      state.writes.push({ path, method: req.method(), body: req.postDataJSON() });
      if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
      if (state.failure)
        return r.fulfill({
          status: state.failure,
          json: { message: state.failure === 409 ? 'Cet ordre a changé.' : 'Indisponible' },
        });
      Object.assign(order, req.postDataJSON(), { updatedAt: '2026-09-15T12:00:00Z' });
      if (path.endsWith('/start')) order.status = 'IN_PROGRESS';
      if (path.endsWith('/complete')) order.status = 'COMPLETED';
      if (path.endsWith('/cancel')) order.status = 'CANCELLED';
      return r.fulfill({ json: order });
    }
    if (path === 'workspace/order-fields')
      return r.fulfill(
        state.fieldsFailure
          ? { status: 503, json: { message: 'Champs indisponibles' } }
          : { json: [] },
      );
    if (path === 'workspace') {
      state.queries.push(url.search);
      if (state.workspaceFailure)
        return r.fulfill({ status: 503, json: { message: 'Parc indisponible' } });
      return r.fulfill({
        json: {
          generatedAt: order.updatedAt,
          summary: { total: 42, available: 30, inService: 8, maintenance: 3, retired: 1 },
          items: [asset],
          total: 42,
          page: Number(url.searchParams.get('page') || 1),
          pageSize: 30,
        },
      });
    }
    if (path === 'workspace/orders')
      return r.fulfill({
        json: {
          generatedAt: order.updatedAt,
          from: '2026-09-14T00:00:00Z',
          until: '2026-09-21T00:00:00Z',
          counts: { dated: 12, overdue: 2, undated: 3, history: 8 },
          days: Array.from({ length: 7 }, (_, i) => ({
            date: `2026-09-${14 + i}`,
            count: i === 2 ? 12 : 0,
          })),
          items: [{ ...order, asset }],
          total: 12,
          page: 1,
          pageSize: 30,
        },
      });
    if (path === 'workspace/assets/vehicle/v1')
      return r.fulfill({
        json: {
          asset,
          orders: { items: [order], total: 1, truncated: false },
          documents: {
            items: [
              {
                id: 'doc',
                docType: 'INSURANCE',
                reference: 'POL-101',
                expiresAt: '2020-01-01T00:00:00Z',
                status: 'EXPIRED',
              },
            ],
            total: 1,
            truncated: false,
          },
          transport: readonly
            ? null
            : {
                items: [{ id: 'load1', loadNumber: 'LD-101', status: 'PLANNED' }],
                truncated: false,
              },
        },
      });
    if (path.startsWith('maintenance-orders/')) return r.fulfill({ json: order });
    return r.fulfill({ status: 404, json: { message: `Unexpected ${path}` } });
  });
  await page.goto('/fleet');
  await expect(page.getByRole('button', { name: 'Consulter TR-101' })).toBeVisible();
  return state;
}
async function dossier(page: Page) {
  await page.getByRole('button', { name: 'Consulter TR-101' }).click();
  await page.getByRole('button', { name: /Inspection des freins/ }).click();
  return page.getByRole('dialog', { name: 'Maintenance · TR-101' });
}
async function confirm(page: Page) {
  await page
    .getByRole('dialog', { name: 'Confirmer l’intervention' })
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
}

test('shows server totals, seven-day workload, filters and pagination', async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByRole('region', { name: 'État global du parc sélectionné' })).toContainText(
    '42',
  );
  await page.getByRole('button', { name: 'Suivante', exact: true }).click();
  await expect.poll(() => state.queries.at(-1)).toContain('page=2');
  await page.getByLabel('Rechercher dans le parc').fill('ABC');
  await expect.poll(() => state.queries.at(-1)).toContain('search=ABC');
  expect(state.queries.at(-1)).toContain('page=1');
  await page.getByRole('tab', { name: 'Échéancier maintenance' }).click();
  await expect(
    page.getByRole('region', { name: 'Charge de maintenance sur sept jours' }),
  ).toContainText('12');
  await page.getByRole('button', { name: 'Historique maintenance' }).click();
  await expect(page.getByLabel('File des interventions')).toHaveValue('history');
  await expect(
    page.getByText('Ordres terminés et annulés, toutes dates', { exact: false }),
  ).toBeVisible();
});
test('connects asset documents, work orders and transport without leaving the park', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Consulter TR-101' }).click();
  const p = page.getByRole('dialog', { name: 'Véhicule TR-101' });
  await expect(p).toContainText('Expiré');
  await expect(p.getByRole('link', { name: /LD-101/ })).toHaveAttribute('href', '/loads/load1');
  await expect(page.getByLabel('Type d’actif')).toBeDisabled();
  await p.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Consulter TR-101' })).toBeEnabled();
});
test('retains a stale edit and confirms discard on refresh', async ({ page }) => {
  const state = await setup(page);
  const p = await dossier(page);
  await p.getByRole('button', { name: 'Modifier l’échéance' }).click();
  await p.getByLabel('Consignes de l’intervention').fill('Nouvelles consignes');
  await p.getByLabel('Échéance (date UTC)').fill('2026-10-01');
  state.failure = 409;
  await p.getByRole('button', { name: 'Enregistrer l’échéance' }).click();
  await confirm(page);
  await expect(p.getByRole('alert')).toContainText('Cet ordre a changé');
  await expect(p.getByLabel('Consignes de l’intervention')).toHaveValue('Nouvelles consignes');
  expect(state.writes[0].body).toMatchObject({
    expectedUpdatedAt: '2026-09-14T12:00:00Z',
    dueDate: '2026-10-01T00:00:00.000Z',
  });
  await p.getByRole('button', { name: 'Actualiser le dossier' }).click();
  await page
    .getByRole('dialog', { name: 'Actualiser le dossier' })
    .getByRole('button', { name: 'Annuler', exact: true })
    .click();
  await expect(p.getByLabel('Consignes de l’intervention')).toHaveValue('Nouvelles consignes');
});
test('completes with cost and mileage only after explicit confirmation', async ({ page }) => {
  const state = await setup(page);
  const p = await dossier(page);
  await p.getByRole('button', { name: 'Terminer', exact: true }).click();
  await p.getByLabel('Coût total').fill('125.50');
  await p.getByLabel('Kilométrage relevé').fill('1000');
  await p.getByRole('button', { name: 'Confirmer la clôture' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmer l’intervention' })).toContainText(
    'Aucun paiement',
  );
  await page
    .getByRole('dialog', { name: 'Confirmer l’intervention' })
    .getByRole('button', { name: 'Annuler', exact: true })
    .click();
  expect(state.writes).toHaveLength(0);
  await p.getByRole('button', { name: 'Confirmer la clôture' }).click();
  await confirm(page);
  await expect(p).toContainText('Terminé');
  expect(state.writes[0].body).toMatchObject({
    costAmount: 125.5,
    costCurrency: 'CAD',
    odometerKm: 1000,
    expectedUpdatedAt: '2026-09-14T12:00:00Z',
  });
});
test('cleared optional cost and mileage are omitted, never coerced to zero', async ({ page }) => {
  const state = await setup(page);
  const p = await dossier(page);
  await p.getByRole('button', { name: 'Terminer', exact: true }).click();
  await p.getByLabel('Coût total').fill('50');
  await p.getByLabel('Coût total').fill('');
  await p.getByLabel('Kilométrage relevé').fill('1000');
  await p.getByLabel('Kilométrage relevé').fill('');
  await p.getByRole('button', { name: 'Confirmer la clôture' }).click();
  await confirm(page);
  await expect(p).toContainText('Terminé');
  expect(state.writes[0].body).not.toHaveProperty('costAmount');
  expect(state.writes[0].body).not.toHaveProperty('odometerKm');
});

test('blocks double actions and closing while a write is pending', async ({ page }) => {
  const state = await setup(page);
  const p = await dossier(page);
  state.delay = 1000;
  await p.getByRole('button', { name: 'Démarrer', exact: true }).click();
  await confirm(page);
  await expect(p.getByRole('button', { name: 'Démarrer', exact: true })).toBeDisabled();
  await expect(p.getByRole('button', { name: 'Fermer', exact: true }).last()).toBeDisabled();
  await expect(p).toContainText('En cours');
  expect(state.writes).toHaveLength(1);
});
test('freezes uncertain writes until the dossier is inspected again', async ({ page }) => {
  const state = await setup(page);
  const p = await dossier(page);
  state.failure = 503;
  await p.getByRole('button', { name: 'Démarrer', exact: true }).click();
  await confirm(page);
  await expect(p.getByRole('alert')).toContainText('Résultat non confirmé');
  await expect(p.getByRole('button', { name: 'Démarrer', exact: true })).toBeDisabled();
  await expect(p.getByRole('button', { name: 'Terminer', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(1);
});
test('a failed custom-field lookup blocks creation and can be retried', async ({ page }) => {
  const state = await setup(page);
  state.fieldsFailure = true;
  await page.getByRole('button', { name: 'Consulter TR-101' }).click();
  await page.getByRole('button', { name: 'Ouvrir une intervention', exact: true }).click();
  const p = page.getByRole('dialog', { name: 'Intervention · TR-101' });
  await expect(
    p.getByRole('button', { name: 'Ouvrir l’intervention', exact: true }),
  ).toBeDisabled();
  state.fieldsFailure = false;
  await p.getByRole('button', { name: 'Réessayer' }).click();
  await p.getByLabel('Consignes de l’intervention').fill('Révision');
  await p.getByRole('button', { name: 'Ouvrir l’intervention', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmer l’intervention' })).toContainText(
    'dès l’ouverture',
  );
  await confirm(page);
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body).toMatchObject({
    vehicleId: 'v1',
    description: 'Révision',
    type: 'REPAIR',
  });
});
test('fleet-only readers inspect records with no mutation or TMS controls', async ({ page }) => {
  await setup(page, true);
  const p = await dossier(page);
  await expect(p.getByRole('button', { name: 'Démarrer', exact: true })).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Terminer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Registre et plans préventifs' })).toHaveCount(0);
});
test('an API failure is not presented as an empty fleet', async ({ page }) => {
  const state = await setup(page);
  state.workspaceFailure = true;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Parc indisponible');
  await expect(page.getByText('Aucun actif correspondant')).toHaveCount(0);
  state.workspaceFailure = false;
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByRole('button', { name: 'Consulter TR-101' })).toBeVisible();
});
test('park, agenda and drawer fit desktop and mobile viewports', async ({ page }) => {
  await setup(page);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'playwright-artifacts/fleet-desktop.png', fullPage: true });
  await page.getByRole('tab', { name: 'Échéancier maintenance' }).click();
  await page.screenshot({ path: 'playwright-artifacts/fleet-agenda.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.getByRole('button', { name: 'Intervention Inspection des freins' }).click();
  await expect(page.getByRole('dialog', { name: 'Maintenance · TR-101' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'playwright-artifacts/fleet-mobile.png', fullPage: true });
});
