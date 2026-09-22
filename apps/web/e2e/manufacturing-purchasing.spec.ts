import { test, expect, type Page } from '@playwright/test';
import { EXPERIENCED_PREFERENCES } from './helpers';
import type {
  MaterialPurchase,
  MaterialRequest,
} from '../src/lib/components/manufacturing/material-purchase-types';

async function setup(
  page: Page,
  options: {
    readonly?: boolean;
    existing?: boolean;
    confirmed?: boolean;
    empty?: boolean;
    lose?: boolean;
    commit?: boolean;
  } = {},
) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (readonly) =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'fixture',
          refreshToken: '',
          user: {
            id: 'buyer',
            firstName: 'Acheteur',
            lastName: 'Test',
            email: 'buyer@example.test',
            permissions: [
              'manufacturing.read',
              'wms.read',
              ...(readonly ? [] : ['manufacturing.manage', 'wms.manage']),
            ],
          },
          tenant: {
            id: 'tenant',
            name: 'Atelier test',
            slug: 'fixture',
            enabledModules: ['manufacturing', 'wms'],
          },
        }),
      ),
    !!options.readonly,
  );
  const prep: MaterialRequest = {
    id: 'prep',
    number: 'MR-000001',
    runId: 'run',
    proposalId: 'proposal',
    itemId: 'steel',
    locationId: 'site',
    quantity: '125.5',
    unitSnapshot: 'KG',
    dueDate: '2026-10-12',
    status: 'DRAFT',
    updatedAt: '2026-09-15T12:00:00Z',
    item: { sku: 'ACIER-304', name: 'Acier inoxydable 304' },
    location: { name: 'Atelier Montréal', code: 'MTL' },
    purchaseOrder: null,
  };
  const supplier = {
    id: 'supplier',
    code: 'METAL',
    name: 'Métaux du Nord',
    email: 'contact@example.test',
    terms: 'Net 30',
    isActive: true,
    updatedAt: prep.updatedAt,
  };
  const template: MaterialPurchase = {
    id: 'purchase',
    number: 'MP-000001',
    status: 'DRAFT',
    preparation: prep,
    supplierId: supplier.id,
    supplier,
    unitPrice: '4.25',
    currency: 'CAD',
    subtotal: '533.38',
    terms: 'Net 30',
    expectedDate: '2026-10-12',
    supplierReference: null,
    confirmedAt: null,
    updatedAt: prep.updatedAt,
    received: '0',
    remaining: '125.5',
    fulfillment: 'NONE',
    receipts: [],
  };
  const state = {
    writes: [] as { path: string; body: any }[],
    order:
      options.existing || options.confirmed
        ? structuredClone(template)
        : (null as MaterialPurchase | null),
    lost: false,
    fail: false,
  };
  if (options.confirmed)
    state.order = {
      ...structuredClone(template),
      status: 'CONFIRMED',
      supplierReference: 'FOUR-101',
      received: '50',
      remaining: '75.5',
      fulfillment: 'PARTIAL',
      receipts: [
        {
          id: 'receipt-old',
          number: 'RC-000001',
          status: 'POSTED',
          quantity: '50',
          postedAt: '2026-10-01',
        },
      ],
    };
  const currentPrep = () => ({
    ...prep,
    purchaseOrder: state.order
      ? { id: state.order.id, number: state.order.number, status: state.order.status }
      : null,
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/me/preferences') return route.fulfill({ json: EXPERIENCED_PREFERENCES });
    if (route.request().method() !== 'GET') {
      const body = route.request().postDataJSON();
      state.writes.push({ path, body });
      if (state.fail)
        return route.fulfill({ status: 409, json: { message: 'Le dossier a changé. Rechargez.' } });
      const create = path === '/manufacturing/material-purchases';
      if (create && (!options.lose || options.commit || state.lost))
        state.order = { ...structuredClone(template), ...body, updatedAt: '2026-09-15T12:01:00Z' };
      if (options.lose && !state.lost && (create || path.endsWith('/receipts'))) {
        state.lost = true;
        return route.abort('failed');
      }
      if (path.endsWith('/confirm'))
        state.order = {
          ...state.order!,
          status: 'CONFIRMED',
          supplierReference: body.supplierReference,
        };
      if (path.endsWith('/amendments')) {
        const order = state.order!;
        order.amendments = [
          ...(order.amendments ?? []),
          {
            id: 'change',
            kind: body.kind,
            reason: body.reason,
            previousDate: order.expectedDate,
            expectedDate: body.expectedDate ?? order.expectedDate,
            closedQuantity: body.kind === 'CLOSE_REMAINDER' ? order.remaining : '0',
            createdAt: '2026-10-03',
          },
        ];
        if (body.kind === 'RESCHEDULE') order.expectedDate = body.expectedDate;
        else {
          order.closedAt = '2026-10-03';
          order.closedQuantity = order.remaining;
          order.remaining = '0';
          order.fulfillment = 'CLOSED';
        }
        order.updatedAt = '2026-10-03T12:00:00Z';
      }
      if (path.endsWith('/receipts')) {
        if (!state.order!.receipts.some((r) => r.id === 'receipt-new'))
          state.order!.receipts.push({
            id: 'receipt-new',
            number: 'RC-000002',
            status: 'DRAFT',
            quantity: body.quantity,
            postedAt: null,
          });
        return route.fulfill({ json: { receiptId: 'receipt-new' } });
      }
      if (path.endsWith('/suppliers')) return route.fulfill({ json: { ...supplier, ...body } });
      if (route.request().method() === 'PUT')
        state.order = { ...state.order!, ...body, updatedAt: '2026-09-15T12:02:00Z' };
      return route.fulfill({ json: state.order });
    }
    if (path.endsWith('/suppliers'))
      return route.fulfill({ json: { items: [supplier], total: 1 } });
    if (path.endsWith('/requests/prep')) return route.fulfill({ json: currentPrep() });
    if (path.endsWith('/requests'))
      return route.fulfill({
        json: { items: options.empty ? [] : [currentPrep()], total: options.empty ? 0 : 1 },
      });
    if (path.endsWith('/purchase')) return route.fulfill({ json: state.order });
    if (path.endsWith('/workspace/arrivals'))
      return route.fulfill({
        json: {
          items: state.order ? [{ ...state.order, arrivalState: 'LATE' }] : [],
          total: state.order ? 1 : 0,
        },
      });
    if (path.endsWith('/bins'))
      return route.fulfill({ json: { items: [{ id: 'bin', code: 'RECEPTION-A' }], total: 1 } });
    return route.fulfill({ json: path.endsWith('/notifications') ? [] : {} });
  });
  await page.goto('/manufacturing/purchasing');
  await expect(page.getByRole('heading', { name: 'Achats matières', exact: true })).toBeVisible();
  return { state, errors, prep };
}
async function openPurchase(page: Page) {
  await page.getByRole('button', { name: /MR-000001/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Acier inoxydable 304' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Recharger le dossier' })).toBeEnabled();
  return dialog;
}
async function createPurchase(page: Page) {
  const dialog = await openPurchase(page);
  await dialog.getByRole('combobox', { name: 'Fournisseur', exact: true }).selectOption('supplier');
  await dialog.getByLabel('Prix unitaire / KG').fill('4.25');
  await dialog.getByRole('button', { name: 'Créer le bon d’achat brouillon' }).click();
  return dialog;
}
test('reschedules an arrival with explicit confirmation and retains its history', async ({
  page,
}) => {
  const { state, errors } = await setup(page, { confirmed: true });
  await page.getByRole('button', { name: 'Arrivages', exact: true }).click();
  await expect(page.getByRole('button', { name: /MP-000001.*encore attendus/ })).toContainText(
    'En retard',
  );
  await page.getByRole('button', { name: /MP-000001/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nouvelle date promise').fill('2026-10-15');
  await dialog.getByLabel('Motif du changement').fill('Retard confirmé par le fournisseur');
  await expect(dialog.getByRole('button', { name: 'Confirmer le changement' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /Je confirme ce changement/ }).check();
  await dialog.getByRole('button', { name: 'Confirmer le changement' }).click();
  await expect(dialog.getByText('2026-10-12 → 2026-10-15')).toBeVisible();
  expect(state.writes[0].body).toMatchObject({
    kind: 'RESCHEDULE',
    expectedDate: '2026-10-15',
    expectedUpdatedAt: '2026-09-15T12:00:00Z',
  });
  expect(errors).toEqual([]);
});

test('closes a partial remainder without presenting it as received stock', async ({ page }) => {
  await setup(page, { confirmed: true });
  const dialog = await openPurchase(page);
  await dialog
    .getByRole('combobox', { name: 'Modification', exact: true })
    .selectOption('CLOSE_REMAINDER');
  await dialog.getByLabel('Motif du changement').fill('Le solde ne sera jamais livré');
  await dialog.getByRole('checkbox', { name: /Je confirme ce changement/ }).check();
  await dialog.getByRole('button', { name: 'Confirmer le changement' }).click();
  await expect(dialog.locator('p').filter({ hasText: 'Aucune réception fictive' })).toContainText(
    'Reliquat clôturé : 75.5 KG.',
  );
  await expect(
    dialog.getByRole('heading', { name: 'Préparer une réception partielle' }),
  ).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Historique des promesses' })).toBeVisible();
});

test('converts an exact request to a draft, then requires an explicit supplier-order confirmation', async ({
  page,
}) => {
  const { state, errors } = await setup(page);
  const dialog = await createPurchase(page);
  await expect(
    dialog.getByRole('button', { name: 'Confirmer l’achat et l’arrivage' }),
  ).toBeDisabled();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body).toMatchObject({
    preparationId: 'prep',
    unitPrice: '4.25',
    currency: 'CAD',
  });
  expect(state.writes[0].body).not.toHaveProperty('quantity');
  await dialog.getByLabel('Référence de la commande fournisseur').fill('FOUR-123');
  await dialog.getByRole('checkbox', { name: /Je confirme que cette commande/ }).check();
  await dialog.getByRole('button', { name: 'Confirmer l’achat et l’arrivage' }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Préparer une réception partielle' }),
  ).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(errors).toEqual([]);
});
test('preserves the exact purchase intention across network loss and reload', async ({ page }) => {
  const { state } = await setup(page, { lose: true });
  const dialog = await createPurchase(page);
  await expect(dialog.getByRole('button', { name: 'Reprendre la même demande' })).toBeVisible();
  const first = state.writes[0];
  await page.reload();
  await openPurchase(page);
  await expect(page.getByLabel('Prix unitaire / KG')).toHaveValue('4.25');
  await page.getByRole('button', { name: 'Reprendre la même demande' }).click();
  await expect(page.getByRole('button', { name: 'Enregistrer les conditions' })).toBeVisible();
  expect(state.writes[1].body).toEqual(first.body);
});
test('inspects a committed purchase after lost response without creating another', async ({
  page,
}) => {
  const { state } = await setup(page, { lose: true, commit: true });
  const dialog = await createPurchase(page);
  await dialog.getByRole('button', { name: 'Recharger le dossier' }).click();
  await expect(dialog.getByRole('button', { name: 'Reprendre la même demande' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Enregistrer les conditions' })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});
test('shows partial stock truthfully and creates only a draft receipt with a WMS link', async ({
  page,
}) => {
  const { state, errors } = await setup(page, { confirmed: true });
  const dialog = await openPurchase(page);
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '50');
  await dialog.getByRole('combobox', { name: 'Emplacement de réception' }).selectOption('bin');
  await dialog.getByLabel('Quantité reçue (KG)').fill('25.5');
  await dialog.getByRole('checkbox', { name: /Je confirme la quantité à vérifier/ }).check();
  await dialog.getByRole('button', { name: 'Créer la réception WMS' }).click();
  await expect(dialog.getByRole('link', { name: /RC-000002/ })).toHaveAttribute(
    'href',
    '/wms/receiving/receipt-new',
  );
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('value', '50');
  expect(state.writes[0].body.quantity).toBe('25.5');
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/material-purchases-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('read-only users can inspect receipts but cannot buy, receive or edit suppliers', async ({
  page,
}) => {
  await setup(page, { confirmed: true, readonly: true });
  const dialog = await openPurchase(page);
  await expect(dialog.getByRole('link', { name: /RC-000001/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Créer la réception WMS' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Annuler la commande' })).toHaveCount(0);
});
test('conflicts preserve entered values and require inspection before another mutation', async ({
  page,
}) => {
  const { state } = await setup(page, { existing: true });
  const dialog = await openPurchase(page);
  await dialog.getByLabel('Prix unitaire / KG').fill('5.25');
  state.fail = true;
  await dialog.getByRole('button', { name: 'Enregistrer les conditions' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Le dossier a changé');
  await expect(dialog.getByLabel('Prix unitaire / KG')).toHaveValue('5.25');
  await expect(dialog.getByRole('button', { name: 'Enregistrer les conditions' })).toBeDisabled();
  expect(state.writes).toHaveLength(1);
});
test('mobile drawer fits the viewport and supplier editing stays in the common panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await setup(page, { existing: true });
  const dialog = await openPurchase(page);
  await expect(dialog).toHaveCSS('opacity', '1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/material-purchases-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fournisseurs', exact: true }).click();
  await page.getByRole('button', { name: 'Nouveau fournisseur' }).click();
  await page.getByLabel('Code fournisseur').fill('NEW');
  await page.getByLabel('Nom du fournisseur').fill('Nouveau partenaire');
  await page.getByRole('button', { name: 'Enregistrer le fournisseur' }).click();
  await expect(page.getByRole('button', { name: 'Nouveau fournisseur' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('receipt recovery preserves quantity, destination and operation key across reload', async ({
  page,
}) => {
  const { state } = await setup(page, { confirmed: true, lose: true });
  const dialog = await openPurchase(page);
  await dialog.getByRole('combobox', { name: 'Emplacement de réception' }).selectOption('bin');
  await dialog.getByLabel('Quantité reçue (KG)').fill('25.5');
  await dialog.getByRole('checkbox', { name: /Je confirme la quantité à vérifier/ }).check();
  await dialog.getByRole('button', { name: 'Créer la réception WMS' }).click();
  await expect(dialog.getByRole('button', { name: 'Reprendre la même demande' })).toBeVisible();
  const original = state.writes[0].body;
  await page.reload();
  await openPurchase(page);
  await expect(page.getByLabel('Quantité reçue (KG)')).toHaveValue('25.5');
  await expect(page.getByRole('combobox', { name: 'Emplacement de réception' })).toHaveValue('bin');
  await page.getByRole('button', { name: 'Reprendre la même demande' }).click();
  await expect(page.getByRole('link', { name: /RC-000002/ })).toBeVisible();
  expect(state.writes[1].body).toEqual(original);
});
test('empty workspace explains the MRP entry point without fake orders', async ({ page }) => {
  await setup(page, { empty: true });
  await expect(
    page.getByRole('heading', { name: 'Les achats commencent par un besoin' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Ouvrir les besoins matières/ })).toHaveAttribute(
    'href',
    '/manufacturing/mrp',
  );
});
