import { test, expect, type Page } from './fixtures';
import { login } from './helpers';

// Real login, all finance reads and writes in this suite use isolated browser fixtures.
const invoice = {
  id: 'flow-invoice',
  invoiceNumber: 'INV-FJ-218',
  carrierId: 'flow-carrier',
  currency: 'CAD',
  status: 'APPROVED',
  totalAmount: '135.08',
  taxAmount: '6.43',
  amountPaid: '0',
  reason: null,
};
const audit = {
  id: 'flow-audit',
  carrierInvoiceNumber: 'AUD-FJ-218',
  carrier: { id: 'flow-carrier', name: 'Transport du Fjord' },
  currency: 'CAD',
  status: 'MATCHED',
  chargedTotal: '128.65',
  matchedTotal: '128.65',
  varianceTotal: '0',
  varianceGross: '0',
  recoveredAmount: '0',
  receivedAt: '2026-09-14T12:00:00Z',
  lines: [],
};
const account = {
  id: 'flow-bank',
  name: 'Opérations CAD',
  currency: 'CAD',
  glAccountCode: '1010',
  accountNumber: '•••• 8026',
  isDefault: true,
};
const payment = {
  id: 'flow-payment',
  paymentNumber: 'PAY-FJ-218',
  type: 'PAY',
  status: 'SUBMITTED',
  currency: 'CAD',
  totalAmount: '135.08',
  allocatedAmount: 135.08,
  partyType: 'CARRIER',
  partyId: 'flow-carrier',
  party: { id: 'flow-carrier', name: 'Transport du Fjord' },
  reconciledAt: null,
  reference: 'FJ-218',
  note: null,
  date: '2026-09-14T12:00:00Z',
  modeOfPayment: { id: 'flow-mode', name: 'Banque', accountCode: '1010' },
  allocations: [
    {
      id: 'flow-allocation',
      targetType: 'CARRIER_INVOICE',
      targetId: invoice.id,
      amount: '135.08',
      target: { id: invoice.id, invoiceNumber: invoice.invoiceNumber },
    },
  ],
};
const txn = {
  id: 'flow-txn',
  bankAccountId: account.id,
  description: 'Virement Transport du Fjord',
  date: '2026-09-14T12:00:00Z',
  amount: '-135.08',
  reference: 'FJ-218',
  status: 'UNRECONCILED',
  matchedPaymentId: null,
};
const wrongTxn = { ...txn, id: 'flow-wrong', description: 'Virement avec écart', amount: '-130' };
const empty = { items: [], total: 0, page: 1, pageSize: 10 };
const flow = (linked: boolean) => ({
  invoice: linked ? invoice : null,
  payments: linked ? [{ ...payment, bankTransaction: null }] : [],
  candidates: linked
    ? empty
    : {
        ...empty,
        total: 2,
        items: [
          invoice,
          {
            ...invoice,
            id: 'wrong-invoice',
            invoiceNumber: 'INV-FJ-219',
            reason: 'Le montant hors taxes de la facture diffère du montant retenu par l’audit.',
          },
        ],
      },
});

async function setup(page: Page) {
  await login(page);
  await page.route('**/api/v1/freight-audit/incoming-invoices/flow-audit', (r) =>
    r.fulfill({ json: audit }),
  );
  await page.route('**/api/v1/freight-audit/incoming-invoices/flow-audit/accounting?**', (r) =>
    r.fulfill({ json: flow(false) }),
  );
  await page.route('**/api/v1/billing/bank-accounts', (r) => r.fulfill({ json: [account] }));
  await page.route('**/api/v1/billing/bank-accounts/*/balance', (r) =>
    r.fulfill({ json: { balance: -135.08, txnCount: 1 } }),
  );
  await page.route('**/api/v1/billing/payments/flow-payment', (r) => r.fulfill({ json: payment }));
  await page.route('**/api/v1/billing/bank-transactions?**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/v1/billing/bank-transactions/reconciliation?**', (r) =>
    r.fulfill({
      json: { unreconciledTransactions: [txn, wrongTxn], candidatePayments: [payment] },
    }),
  );
}
test.beforeEach(async ({ page }) => setup(page));

test('audit association explains refusals, confirms explicitly and connects the financial documents', async ({
  page,
}) => {
  let linked = false,
    writes = 0;
  await page.route('**/api/v1/freight-audit/incoming-invoices/flow-audit/accounting?**', (r) =>
    r.fulfill({ json: flow(linked) }),
  );
  await page.route('**/api/v1/freight-audit/incoming-invoices/flow-audit/link-invoice', (r) => {
    writes++;
    expect(r.request().postDataJSON()).toEqual({ invoiceId: invoice.id });
    linked = true;
    return r.fulfill({ json: { accountingInvoiceId: invoice.id } });
  });
  await page.goto('/billing/freight-audit/flow-audit');
  await page.getByRole('button', { name: 'Associer une facture existante' }).click();
  const panel = page.getByRole('dialog', { name: 'Associer une facture comptable', exact: true });
  await expect(panel.getByRole('button', { name: 'Associer INV-FJ-219' })).toBeDisabled();
  await expect(panel).toContainText('montant hors taxes');
  await panel.getByRole('button', { name: 'Associer INV-FJ-218' }).click();
  const confirm = page.getByRole('dialog', {
    name: 'Associer la facture comptable ?',
    exact: true,
  });
  await expect(confirm).toContainText('ni paiement');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toBe(0);
  await panel.getByRole('button', { name: 'Associer INV-FJ-218' }).click();
  await confirm.getByRole('button', { name: 'Associer', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(
    page.getByRole('link', { name: invoice.invoiceNumber, exact: true }),
  ).toHaveAttribute('href', '/invoices?invoice=flow-invoice');
  await expect(page.getByRole('link', { name: 'Préparer le paiement' })).toHaveAttribute(
    'href',
    /target=flow-invoice/,
  );
  await expect(page.getByRole('link', { name: 'À rapprocher en banque' })).toHaveAttribute(
    'href',
    '/billing/banking?payment=flow-payment',
  );
  expect(writes).toBe(1);
  await page.screenshot({
    path: 'playwright-artifacts/finance-connected-audit.png',
    fullPage: true,
  });
});

test('association failure preserves the candidate panel', async ({ page }) => {
  await page.route('**/api/v1/freight-audit/incoming-invoices/flow-audit/link-invoice', (r) =>
    r.fulfill({
      status: 409,
      json: { message: 'Cette facture est déjà associée à un autre audit.' },
    }),
  );
  await page.goto('/billing/freight-audit/flow-audit');
  await page.getByRole('button', { name: 'Associer une facture existante' }).click();
  const panel = page.getByRole('dialog', { name: 'Associer une facture comptable', exact: true });
  await panel.getByRole('button', { name: 'Associer INV-FJ-218' }).click();
  await page
    .getByRole('dialog', { name: 'Associer la facture comptable ?', exact: true })
    .getByRole('button', { name: 'Associer', exact: true })
    .click();
  await expect(panel.getByRole('alert')).toContainText('déjà associée');
  await expect(panel.getByRole('button', { name: 'Associer INV-FJ-218' })).toBeEnabled();
});

test('bank opens from payment, rejects an incompatible selection and retains a failed match', async ({
  page,
}) => {
  let writes = 0;
  await page.route('**/api/v1/billing/bank-transactions/flow-txn/match', (r) => {
    writes++;
    expect(r.request().postDataJSON()).toEqual({ paymentId: payment.id });
    return r.fulfill({ status: 409, json: { message: 'Paiement déjà rapproché. Actualisez.' } });
  });
  await page.goto('/billing/banking?payment=flow-payment');
  await expect(page.getByRole('tab', { name: 'Rapprochement', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: /PAY-FJ-218/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: /Virement avec écart/ }).click();
  await expect(
    page.getByText('Le montant ou le sens du mouvement ne correspond pas au paiement.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rapprocher la sélection' })).toBeDisabled();
  await page.getByRole('button', { name: /Virement Transport du Fjord/ }).click();
  await page.getByRole('button', { name: 'Rapprocher la sélection' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirmer le rapprochement ?', exact: true });
  await expect(confirm).toContainText('Aucun transfert');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Rapprocher la sélection' }).click();
  await confirm.getByRole('button', { name: 'Rapprocher', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Paiement déjà rapproché');
  expect(writes).toBe(1);
  await expect(page.getByRole('link', { name: 'Retour au paiement' })).toHaveAttribute(
    'href',
    '/billing/payments/flow-payment',
  );
});

test('matched movement links back to payment and removing it requires confirmation', async ({
  page,
}) => {
  let matched = true,
    writes = 0;
  await page.route('**/api/v1/billing/bank-transactions?**', (r) =>
    r.fulfill({
      json: matched ? [{ ...txn, status: 'RECONCILED', matchedPaymentId: payment.id }] : [],
    }),
  );
  await page.route('**/api/v1/billing/bank-transactions/reconciliation?**', (r) =>
    r.fulfill({
      json: {
        unreconciledTransactions: matched ? [] : [txn],
        candidatePayments: matched ? [] : [payment],
      },
    }),
  );
  await page.route('**/api/v1/billing/bank-transactions/flow-txn/unmatch', (r) => {
    writes++;
    matched = false;
    return r.fulfill({ json: txn });
  });
  await page.goto('/billing/banking?payment=flow-payment');
  await expect(page.getByRole('link', { name: 'Ouvrir le paiement' })).toHaveAttribute(
    'href',
    '/billing/payments/flow-payment',
  );
  await page.getByRole('button', { name: 'Retirer le rapprochement', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Retirer le rapprochement ?', exact: true });
  await expect(confirm).toContainText('soldes des factures restent inchangés');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Retirer le rapprochement', exact: true }).click();
  await confirm.getByRole('button', { name: 'Retirer le rapprochement', exact: true }).click();
  await expect(page.getByRole('button', { name: /Virement Transport du Fjord/ })).toBeVisible();
  expect(writes).toBe(1);
});

test('payment shows bank status and prevents cancellation while reconciled', async ({ page }) => {
  await page.route('**/api/v1/billing/payments/flow-payment', (r) =>
    r.fulfill({ json: { ...payment, reconciledAt: '2026-09-14T12:00:00Z' } }),
  );
  await page.goto('/billing/payments/flow-payment');
  await expect(page.getByRole('button', { name: 'Annuler le paiement' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Voir le rapprochement' })).toHaveAttribute(
    'href',
    '/billing/banking?payment=flow-payment',
  );
});

test('bank account changes cannot be overwritten by a delayed previous response', async ({
  page,
}) => {
  const other = { ...account, id: 'bank-other', name: 'Réserve CAD' };
  await page.route('**/api/v1/billing/bank-accounts', (r) => r.fulfill({ json: [account, other] }));
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route('**/api/v1/billing/bank-transactions/reconciliation?**', async (r) => {
    if (new URL(r.request().url()).searchParams.get('bankAccountId') === account.id) {
      started = true;
      await deferred;
      return r.fulfill({ json: { unreconciledTransactions: [txn], candidatePayments: [payment] } });
    }
    return r.fulfill({
      json: {
        unreconciledTransactions: [{ ...txn, id: 'other-txn', description: 'Mouvement réserve' }],
        candidatePayments: [],
      },
    });
  });
  await page.goto('/billing/banking');
  await page.getByRole('tab', { name: 'Rapprochement' }).click();
  await page.getByRole('combobox', { name: 'Compte', exact: true }).selectOption(account.id);
  await expect.poll(() => started).toBe(true);
  await page.getByRole('combobox', { name: 'Compte', exact: true }).selectOption(other.id);
  await expect(page.getByRole('button', { name: /Mouvement réserve/ })).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: /Virement Transport du Fjord/ })).toHaveCount(0);
});

test('financial context and candidate drawer fit at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/billing/banking?payment=flow-payment');
  await page.getByRole('button', { name: /Virement Transport du Fjord/ }).click();
  await expect(page.getByRole('button', { name: 'Rapprocher la sélection' })).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: 'playwright-artifacts/finance-connected-bank-mobile.png',
    fullPage: true,
  });
  await page.goto('/billing/freight-audit/flow-audit');
  await page.getByRole('button', { name: 'Associer une facture existante' }).click();
  const panel = page.getByRole('dialog', { name: 'Associer une facture comptable', exact: true });
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  const box = await panel.boundingBox();
  expect(Math.round(box!.width)).toBeLessThanOrEqual(390);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: 'playwright-artifacts/finance-connected-association-mobile.png',
    fullPage: true,
  });
});
