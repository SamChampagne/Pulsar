import { test, expect, type Page } from './fixtures';
import { login } from './helpers';

// Login is real; every finance write is intercepted. Posting correctness is tested
// in payments.e2e-spec.ts against the separate test database.
const carrier = { id: 'fa-carrier', name: 'Transport du Fjord' };
const record = {
  id: 'fa-record',
  carrierInvoiceNumber: 'FA-UI-21',
  carrier,
  currency: 'CAD',
  status: 'FLAGGED',
  chargedTotal: '128.65',
  matchedTotal: '100',
  varianceTotal: '28.65',
  varianceGross: '28.65',
  recoveredAmount: '0',
  receivedAt: '2026-09-14T12:00:00Z',
  lines: [
    {
      id: 'fa-line',
      lineRef: 'LD-UI-21',
      description: 'Transport Québec',
      chargedAmount: '128.65',
      matchedLoadId: 'fa-load',
      expectedAmount: '100',
      variance: '28.65',
    },
  ],
};
const entry = {
  id: 'entry-1',
  date: '2026-09-14T12:00:00Z',
  memo: 'Payment PAY-UI-21',
  sourceType: 'payment',
  sourceId: 'fa-payment',
  sourceKind: null,
  lines: [
    {
      accountId: 'cash',
      account: { code: '1000', name: 'Banque' },
      debit: '28.65',
      credit: '0',
      memo: null,
    },
    {
      accountId: 'ar',
      account: { code: '1100', name: 'Comptes clients' },
      debit: '0',
      credit: '28.65',
      memo: null,
    },
  ],
};
async function mockFinance(page: Page) {
  await page.route('**/api/v1/freight-audit/incoming-invoices/fa-record/accounting?**', (r) =>
    r.fulfill({
      json: {
        invoice: null,
        payments: [],
        candidates: { items: [], total: 0, page: 1, pageSize: 10 },
      },
    }),
  );
  await page.route('**/api/v1/freight-audit/incoming-invoices', (r) =>
    r.fulfill({ json: [record] }),
  );
  await page.route('**/api/v1/freight-audit/incoming-invoices/fa-record', (r) =>
    r.fulfill({ json: record }),
  );
  await page.route('**/api/v1/freight-audit/savings?**', (r) =>
    r.fulfill({
      json: {
        tenantTotal: 99999,
        byAgent: [],
        byCurrency: [
          { currency: 'CAD', recovered: 128.65 },
          { currency: 'USD', recovered: 63.27 },
        ],
      },
    }),
  );
  await page.route('**/api/v1/billing/custom-fields?**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/v1/transportation/carriers**', (r) =>
    r.fulfill({
      json: new URL(r.request().url()).pathname.endsWith('/carriers')
        ? { items: [carrier], total: 1 }
        : carrier,
    }),
  );
  await page.route('**/api/v1/billing/ledger/accounts', (r) =>
    r.fulfill({
      json: [
        { id: 'cash', code: '1000', name: 'Banque', type: 'ASSET', active: true },
        { id: 'ar', code: '1100', name: 'Comptes clients', type: 'ASSET', active: true },
      ],
    }),
  );
  await page.route('**/api/v1/billing/ledger/journal?**', (r) =>
    r.fulfill({ json: { items: [entry], total: 1, page: 1, pageSize: 25 } }),
  );
  await page.route('**/api/v1/billing/ledger/trial-balance**', (r) =>
    r.fulfill({ json: { rows: [], totalDebit: 0, totalCredit: 0 } }),
  );
  await page.route('**/api/v1/modules/billing/settings', (r) =>
    r.fulfill({ json: { values: { ledgerManualEntries: true } } }),
  );
}
test.beforeEach(async ({ page }) => {
  await login(page);
  await mockFinance(page);
});

test('audit worklist uses French statuses, scoped counts and separate currencies', async ({
  page,
}) => {
  await page.goto('/billing/freight-audit');
  await expect(
    page.getByRole('heading', { name: 'Audit transporteur', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('128.65 CAD', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('63.27 USD', { exact: true })).toBeVisible();
  await expect(page.getByText('99,999')).toHaveCount(0);
  await expect(page.getByText(/50 maximum/)).toBeVisible();
  await page.screenshot({ path: 'playwright-artifacts/finance-audit-list.png', fullPage: true });
  await page.getByRole('combobox', { name: 'Statut', exact: true }).selectOption('MATCHED');
  await expect(page.getByText('Aucun dossier correspondant', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Statut', exact: true }).selectOption('');
  await page.getByRole('link', { name: 'FA-UI-21', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('FA-UI-21');
  await expect(page.getByRole('link', { name: 'LD-UI-21', exact: true })).toHaveAttribute(
    'href',
    '/loads/fa-load',
  );
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => {})),
    );
  });
  await page.screenshot({ path: 'playwright-artifacts/finance-audit-record.png', fullPage: true });
});

test('auxiliary failure keeps the audit list usable and prevents unsafe intake', async ({
  page,
}) => {
  await page.route('**/api/v1/billing/custom-fields?**', (r) =>
    r.fulfill({ status: 503, json: { message: 'Unavailable' } }),
  );
  await page.goto('/billing/freight-audit');
  await expect(page.getByRole('link', { name: 'FA-UI-21' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('champs personnalisés');
  await expect(
    page.getByRole('button', { name: 'Saisir une facture', exact: true }),
  ).toBeDisabled();
});

test('intake uses a carrier picker and keeps failed submissions in the drawer', async ({
  page,
}) => {
  let body: any;
  await page.route('**/api/v1/freight-audit/incoming-invoices', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: [record] });
    body = r.request().postDataJSON();
    return r.fulfill({ status: 400, json: { message: 'Référence à vérifier.' } });
  });
  await page.goto('/billing/freight-audit');
  await page.getByRole('button', { name: 'Saisir une facture', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Saisir une facture transporteur', exact: true });
  await panel.getByRole('button', { name: /^Transporteur :/ }).click();
  await page
    .getByRole('dialog', { name: 'Transporteur', exact: true })
    .getByRole('option', { name: carrier.name, exact: true })
    .click();
  await panel.getByLabel('Numéro de facture transporteur', { exact: true }).fill('FA-NEW-21');
  await panel.getByRole('combobox', { name: 'Devise', exact: true }).selectOption('USD');
  await panel.getByLabel('Chargement · ligne 1', { exact: true }).fill('LD-REAL-21');
  await panel.getByLabel('Montant facturé · ligne 1', { exact: true }).fill('128.65');
  await panel.getByRole('button', { name: 'Enregistrer la facture' }).click();
  await expect(panel.getByRole('alert')).toContainText('Référence à vérifier');
  expect(body).toMatchObject({
    carrierId: carrier.id,
    currency: 'USD',
    lines: [{ lineRef: 'LD-REAL-21', chargedAmount: 128.65 }],
  });
  await expect(panel.getByLabel('Numéro de facture transporteur', { exact: true })).toHaveValue(
    'FA-NEW-21',
  );
  await panel.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  const confirm = page.getByRole('dialog', { name: 'Fermer la saisie ?', exact: true });
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(panel).toBeVisible();
});

test('dispute drawer retains its note after an API rejection', async ({ page }) => {
  await page.route('**/api/v1/freight-audit/incoming-invoices/fa-record/dispute', (r) =>
    r.fulfill({ status: 409, json: { message: 'Dossier modifié, rechargez.' } }),
  );
  await page.goto('/billing/freight-audit/fa-record');
  await page.getByRole('button', { name: 'Ouvrir un litige' }).click();
  const panel = page.getByRole('dialog', { name: 'Ouvrir un litige', exact: true });
  await panel.getByLabel('Note', { exact: true }).fill('Vérifier le supplément carburant.');
  await panel.getByRole('button', { name: 'Enregistrer le litige' }).click();
  await expect(panel.getByRole('alert')).toContainText('Dossier modifié');
  await expect(panel.getByLabel('Note', { exact: true })).toHaveValue(
    'Vérifier le supplément carburant.',
  );
});

test('mark settled explains its scope and does nothing when confirmation is canceled', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/v1/freight-audit/incoming-invoices/fa-record', (r) =>
    r.fulfill({ json: { ...record, status: 'MATCHED' } }),
  );
  await page.route('**/api/v1/freight-audit/incoming-invoices/fa-record/pay', (r) => {
    calls++;
    return r.fulfill({ json: { ...record, status: 'PAID' } });
  });
  await page.goto('/billing/freight-audit/fa-record');
  await page.getByRole('button', { name: 'Marquer réglée', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Marquer cette facture réglée ?', exact: true });
  await expect(confirm).toContainText('aucune écriture comptable');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Marquer réglée', exact: true }).click();
  await confirm.getByRole('button', { name: 'Marquer réglée', exact: true }).click();
  await expect(
    page.locator('header').filter({ has: page.getByRole('heading', { level: 1 }) }),
  ).toContainText('Réglée (suivi)');
  expect(calls).toBe(1);
});

test('journal opens on an exact source and keeps that source when filtering', async ({ page }) => {
  await page.goto('/billing/ledger?sourceType=payment&sourceId=fa-payment');
  await expect(page.getByRole('tab', { name: 'Journal', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Payment PAY-UI-21')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ouvrir la source' }).first()).toHaveAttribute(
    'href',
    '/billing/payments/fa-payment',
  );
  const req = page.waitForRequest(
    (r) =>
      r.url().includes('/ledger/journal?') &&
      new URL(r.url()).searchParams.get('accountId') === 'cash',
  );
  await page.getByRole('combobox', { name: 'Compte', exact: true }).selectOption('cash');
  const params = new URL((await req).url()).searchParams;
  expect(params.get('sourceType')).toBe('payment');
  expect(params.get('sourceId')).toBe('fa-payment');
  expect(params.get('page')).toBe('1');
  await page.getByRole('button', { name: 'Voir toutes les écritures' }).click();
  await expect(page).toHaveURL('/billing/ledger');
});

test('journal error is not represented as an empty ledger and retry recovers', async ({ page }) => {
  let attempt = 0;
  await page.route('**/api/v1/billing/ledger/journal?**', (r) =>
    r.fulfill(
      ++attempt === 1
        ? { status: 503, json: { message: 'Journal indisponible.' } }
        : { json: { items: [entry], total: 1, page: 1, pageSize: 25 } },
    ),
  );
  await page.goto('/billing/ledger?sourceType=payment&sourceId=fa-payment');
  await expect(page.getByRole('alert')).toContainText('Journal indisponible');
  await expect(page.getByText('Aucune écriture', { exact: true })).toHaveCount(0);
  await page.getByRole('alert').getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByText('Payment PAY-UI-21')).toBeVisible();
});

test('manual journal entry uses a drawer and explicit posting confirmation', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/v1/billing/ledger/entries', (r) => {
    calls++;
    return r.fulfill({ status: 400, json: { message: 'Compte suspendu.' } });
  });
  await page.goto('/billing/ledger?sourceType=payment&sourceId=fa-payment');
  await page.getByRole('button', { name: 'Nouvelle écriture manuelle', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Nouvelle écriture manuelle', exact: true });
  await panel.getByRole('button', { name: /^Compte · ligne 1 :/ }).click();
  await page
    .getByRole('dialog', { name: 'Compte · ligne 1', exact: true })
    .getByRole('option', { name: /^1000/ })
    .click();
  await panel.getByLabel('Débit · ligne 1').fill('28.65');
  await panel.getByRole('button', { name: /^Compte · ligne 2 :/ }).click();
  await page
    .getByRole('dialog', { name: 'Compte · ligne 2', exact: true })
    .getByRole('option', { name: /^1100/ })
    .click();
  await panel.getByLabel('Crédit · ligne 2').fill('28.65');
  await panel.getByRole('button', { name: 'Comptabiliser l’écriture', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Comptabiliser l’écriture ?', exact: true });
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(calls).toBe(0);
  await panel.getByRole('button', { name: 'Comptabiliser l’écriture', exact: true }).click();
  await confirm.getByRole('button', { name: 'Comptabiliser', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Compte suspendu');
  await expect(panel.getByLabel('Débit · ligne 1')).toHaveValue('28.65');
  expect(calls).toBe(1);
});

test('finance screens and drawers remain contained at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    '/billing/freight-audit',
    '/billing/freight-audit/fa-record',
    '/billing/ledger?sourceType=payment&sourceId=fa-payment',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
  await page.getByRole('button', { name: 'Nouvelle écriture manuelle', exact: true }).click();
  const box = await page
    .getByRole('dialog', { name: 'Nouvelle écriture manuelle', exact: true })
    .boundingBox();
  expect(Math.round(box!.width)).toBeLessThanOrEqual(390);
  await expect
    .poll(() =>
      page
        .getByRole('dialog', { name: 'Nouvelle écriture manuelle', exact: true })
        .evaluate((el) => getComputedStyle(el).opacity),
    )
    .toBe('1');
  const save = await page
    .getByRole('button', { name: 'Comptabiliser l’écriture', exact: true })
    .boundingBox();
  expect(save!.x).toBeGreaterThanOrEqual(0);
  expect(Math.round(save!.x + save!.width)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'playwright-artifacts/finance-ledger-mobile.png', fullPage: true });
});
