import { test, expect, type Page } from './fixtures';
import { TOUR_MODULE_KEYS } from '@pulsar/shared';

async function setup(page: Page, unseen: string[] = [], manage = true) {
  const tours: Record<string, any> = Object.fromEntries(
    TOUR_MODULE_KEYS.filter((k) => !unseen.includes(k)).map((k) => [
      k,
      { version: 1, step: 4, status: 'COMPLETED' },
    ]),
  );
  const writes: any[] = [];
  const control = { failSave: false };
  await page.addInitScript(
    ({ manage }) =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'test',
          refreshToken: 'test',
          user: {
            id: 'scanner-user',
            firstName: 'Test',
            lastName: 'Scanner',
            permissions: [
              'wms.read',
              'manufacturing.read',
              'manufacturing.manage',
              'transportation.planning.read',
              'transportation.master-data.read',
              ...(manage ? ['wms.manage'] : []),
            ],
          },
          tenant: {
            id: 'scanner-tenant',
            slug: 'test',
            name: 'Atelier',
            enabledModules: ['wms', 'manufacturing', 'transportation'],
          },
        }),
      ),
    { manage },
  );
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith('unseen-count') ? { count: 0 } : [] });
  });
  await page.route('**/api/v1/me/preferences', (route) => {
    if (route.request().method() === 'PUT') {
      const p = route.request().postDataJSON().moduleTour;
      if (control.failSave)
        return route.fulfill({ status: 503, json: { message: 'Indisponible' } });
      if (p) {
        writes.push(p);
        tours[p.moduleKey] = p;
      }
    }
    return route.fulfill({ json: { appearance: {}, deskLayout: {}, moduleTours: tours } });
  });
  await page.route('**/api/v1/manufacturing/calendars**', (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 25 } }),
  );
  page.on('pageerror', (error) => {
    throw error;
  });
  return { tours, writes, control };
}

test('first presentation is saved immediately; reload stays quiet and replay is voluntary', async ({
  page,
}) => {
  const { writes } = await setup(page, ['wms']);
  await page.goto('/wms/cycle-counts');
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Étape 1 sur 5');
  await expect(tour.locator('[aria-hidden="true"]')).toBeVisible();
  await expect
    .poll(() => writes.at(-1))
    .toMatchObject({
      moduleKey: 'wms',
      status: 'IN_PROGRESS',
      step: 0,
    });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Comptages cycliques' })).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.getByRole('button', { name: 'Tutoriel du module', exact: true }).click();
  await expect(tour).toContainText('Étape 1 sur 5');
  for (let step = 1; step < 5; step++) {
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
    await expect(tour).toContainText(`Étape ${step + 1} sur 5`);
  }
  await tour.getByRole('button', { name: 'Terminer', exact: true }).click();
  await expect(tour).toBeHidden();
  expect(writes.at(-1)).toMatchObject({ moduleKey: 'wms', status: 'COMPLETED', step: 4 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Comptages cycliques' })).toBeVisible();
  await expect(tour).toHaveCount(0);
});

test('tutorial navigation explores actual screens and is independently saved per module', async ({
  page,
}) => {
  const { writes } = await setup(page, ['wms', 'manufacturing']);
  await page.goto('/wms/cycle-counts');
  const tour = page.getByTestId('module-tour');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: /Explorer/ }).click();
  await expect(page).toHaveURL(/\/wms\/bins$/);
  await expect(tour).toContainText('Étape 2 sur 5');
  await tour.getByRole('button', { name: 'Passer le tutoriel' }).click();
  await expect(tour).toBeHidden();
  await page.goto('/manufacturing/calendars');
  await expect(tour).toContainText('Étape 1 sur 5');
  expect(writes.filter((write) => write.moduleKey === 'wms').at(-1)).toMatchObject({
    status: 'SKIPPED',
  });
  await expect
    .poll(() => writes.at(-1))
    .toMatchObject({
      moduleKey: 'manufacturing',
      status: 'IN_PROGRESS',
      step: 0,
    });
});

test('failed tutorial persistence does not mark it seen; replay works from page help on mobile', async ({
  page,
}) => {
  const { control, writes } = await setup(page, ['wms']);
  control.failSave = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/wms/cycle-counts');
  const tour = page.getByTestId('module-tour');
  await expect(tour.getByRole('alert')).toContainText('non enregistrée');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour.getByRole('alert')).toContainText('non enregistrée');
  await expect(tour).toContainText('Étape 1 sur 5');
  expect(writes).toHaveLength(0);
  control.failSave = false;
  await tour.getByRole('button', { name: 'Passer le tutoriel' }).click();
  await page.getByRole('button', { name: 'Aide sur cette page' }).click();
  await page.getByRole('button', { name: 'Relancer le guide du module' }).click();
  await expect(tour).toContainText('Étape 1 sur 5');
  const box = await tour.getByRole('dialog').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Tab');
  await expect.poll(() => tour.evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

test('USB-style Enter and DataWedge-style Tab preserve leading zeros and only resolve records', async ({
  page,
}) => {
  await setup(page);
  const scans: any[] = [];
  await page.route('**/api/v1/scan/wms', (route) => {
    scans.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        id: 'i1',
        kind: 'item',
        code: 'PART-1',
        name: 'Pièce test',
        unit: 'EA',
        href: '/wms/items',
      },
    });
  });
  await page.goto('/wms/cycle-counts');
  await page.getByRole('button', { name: 'Scanner un code', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Scanner dans ce module' });
  const input = dialog.getByRole('textbox', { name: 'Code à scanner' });
  await expect(input).toBeFocused();
  await input.fill('001234');
  await input.press('Enter');
  await expect(dialog.getByRole('status')).toContainText('PART-1');
  await expect(input).toBeFocused();
  await input.fill('001234');
  await input.press('Tab');
  await expect.poll(() => scans.length).toBe(2);
  expect(scans).toEqual([
    { kind: 'item', code: '001234' },
    { kind: 'item', code: '001234' },
  ]);
  await expect(dialog.getByText('Il ne valide ni réception', { exact: false })).toBeVisible();
});

test('ambiguous scanner codes show an error and no record link', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/scan/wms', (route) =>
    route.fulfill({ status: 409, json: { message: 'Code ambigu : deux articles.' } }),
  );
  await page.goto('/wms/cycle-counts');
  await page.getByRole('button', { name: 'Scanner un code', exact: true }).click();
  await page.getByRole('textbox', { name: 'Code à scanner' }).fill('DUP');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Code ambigu');
  await expect(page.getByRole('link', { name: 'Ouvrir l’écran associé' })).toHaveCount(0);
});

test('manufacturing article picker accepts a barcode without leaving the BOM form', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/manufacturing/boms**', (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.route('**/api/v1/wms/choices/items**', (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.route('**/api/v1/scan/wms', (route) =>
    route.fulfill({ json: { id: 'i1', kind: 'item', code: 'PART-1', name: 'Pièce', unit: 'EA' } }),
  );
  await page.goto('/manufacturing/boms');
  await page
    .getByRole('button', { name: /Nouvelle nomenclature/ })
    .first()
    .click();
  await page.getByRole('button', { name: /^Produit :/ }).click();
  await page.getByRole('button', { name: 'Scanner un code-barres' }).click();
  await page.getByRole('textbox', { name: 'Scanner un article' }).fill('001234');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Produit : PART-1/ })).toBeVisible();
  await expect(page).toHaveURL(/\/manufacturing\/boms$/);
});

test('counting +1 scans change only the draft; explicit record preserves version and blanks', async ({
  page,
}) => {
  await setup(page);
  const count: any = {
    id: 'cc1',
    number: 'CC-1',
    status: 'OPEN',
    updatedAt: '2026-09-21T12:00:00.000Z',
    binId: 'b1',
    bin: { code: 'A-01' },
    lines: [
      {
        id: 'l1',
        itemId: 'i1',
        systemQty: '3',
        countedQty: null,
        item: { sku: 'PART-1', name: 'Pièce' },
      },
      {
        id: 'l2',
        itemId: 'i2',
        systemQty: '1',
        countedQty: null,
        item: { sku: 'PART-2', name: 'Autre' },
      },
    ],
  };
  let record: any;
  await page.route('**/api/v1/wms/cycle-counts**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/counts')) {
      record = route.request().postDataJSON();
      count.status = 'COUNTED';
      count.lines[0].countedQty = '2';
    }
    return route.fulfill({ json: path.endsWith('/cycle-counts') ? [count] : count });
  });
  await page.route('**/api/v1/scan/wms', (route) =>
    route.fulfill({ json: { id: 'i1', kind: 'item', code: 'PART-1', name: 'Pièce', unit: 'EA' } }),
  );
  await page.goto('/wms/cycle-counts');
  await page.getByRole('button', { name: /CC-1/ }).click();
  await page.getByLabel('Mode de comptage').selectOption('increment');
  const input = page.getByRole('textbox', { name: 'Scanner l’article à compter' });
  for (let i = 1; i <= 2; i++) {
    await input.fill('001234');
    await input.press('Enter');
    await expect(page.getByRole('spinbutton', { name: 'Quantité comptée : PART-1' })).toHaveValue(
      String(i),
    );
    await expect(input).toBeEnabled();
  }
  expect(record).toBeUndefined();
  await expect(page.getByRole('spinbutton', { name: 'Quantité comptée : PART-2' })).toHaveValue('');
  await page.getByRole('button', { name: 'Enregistrer le comptage' }).click();
  expect(record).toBeUndefined();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Réconcilier', exact: true })).toBeVisible();
  expect(record).toEqual({
    counts: [{ lineId: 'l1', countedQty: 2 }],
    expectedUpdatedAt: count.updatedAt,
  });
});
