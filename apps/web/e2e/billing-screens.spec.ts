import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

// All writes are intercepted. Accounting integration is exercised separately by
// payments.e2e-spec.ts against the isolated test database, never by this UI suite.
const customer = { id: 'billing-customer', name: 'Atelier Boréal', code: 'BOR', email: null };
const carrier = { id: 'billing-carrier', name: 'Transport du Fjord' };
const mode = { id: 'billing-mode', name: 'Virement bancaire', isDefault: true };
const statement = {
  id: 'billing-statement',
  invoiceNumber: 'CI-UI-1',
  status: 'APPROVED',
  currency: 'CAD',
  totalAmount: '120',
  amountPaid: '0',
  taxAmount: '0',
  taxDetail: null,
  taxTemplateId: null,
  createdAt: '2026-09-14T12:00:00Z',
  customer,
  lines: [
    {
      id: 'statement-line',
      description: 'Livraison',
      amount: '120',
      priceDetail: null,
      transportOrder: { id: 'order-ui', orderNumber: 'TO-UI-1' },
    },
  ],
};
const invoice = {
  ...statement,
  id: 'billing-invoice',
  invoiceNumber: 'INV-UI-1',
  carrier,
  invoicedTotal: null,
  varianceTotal: null,
  varianceGross: null,
  carrierInvoiceNumber: null,
  disputeReasonCode: null,
  disputeNote: null,
  lines: [
    {
      id: 'invoice-line',
      description: 'Trajet Québec',
      amount: '120',
      invoicedAmount: null,
      variance: null,
      load: { id: 'load-ui', loadNumber: 'LD-UI-1' },
    },
  ],
};
const openInvoice = { ...statement, outstanding: 120, targetType: 'CUSTOMER_INVOICE' };
const draft = {
  id: 'billing-payment',
  paymentNumber: 'PAY-UI-1',
  type: 'RECEIVE',
  partyType: 'CUSTOMER',
  partyId: customer.id,
  party: customer,
  date: '2026-09-14T12:00:00Z',
  totalAmount: '40',
  currency: 'CAD',
  reference: 'VIR-UI',
  note: null,
  status: 'DRAFT',
  modeOfPayment: mode,
  allocations: [
    {
      id: 'alloc-ui',
      targetType: 'CUSTOMER_INVOICE',
      targetId: statement.id,
      amount: '40',
      target: { id: statement.id, invoiceNumber: statement.invoiceNumber },
    },
  ],
};

async function mockBilling(page: Page) {
  await page.route('**/api/v1/billing/payments', (r) => r.fulfill({ json: [draft] }));
  await page.route('**/api/v1/billing/payments/billing-payment', (r) => r.fulfill({ json: draft }));
  await page.route('**/api/v1/billing/modes-of-payment', (r) => r.fulfill({ json: [mode] }));
  await page.route('**/api/v1/billing/payments/open-invoices?**', (r) =>
    r.fulfill({
      json: [
        openInvoice,
        { ...openInvoice, id: 'usd-invoice', invoiceNumber: 'CI-USD', currency: 'USD' },
      ],
    }),
  );
  await page.route('**/api/v1/transportation/customers**', (r) =>
    r.fulfill({
      json: new URL(r.request().url()).pathname.endsWith('/customers')
        ? { items: [customer], total: 1 }
        : customer,
    }),
  );
  await page.route('**/api/v1/transportation/carriers**', (r) =>
    r.fulfill({
      json: new URL(r.request().url()).pathname.endsWith('/carriers')
        ? { items: [carrier], total: 1 }
        : carrier,
    }),
  );
  await page.route('**/api/v1/billing/customer-invoices', (r) => r.fulfill({ json: [statement] }));
  await page.route('**/api/v1/billing/customer-invoices/billing-statement', (r) =>
    r.fulfill({ json: statement }),
  );
  await page.route('**/api/v1/billing/invoices', (r) => r.fulfill({ json: [invoice] }));
  await page.route('**/api/v1/billing/invoices/billing-invoice', (r) =>
    r.fulfill({ json: invoice }),
  );
  await page.route('**/api/v1/billing/tax-templates**', (r) => r.fulfill({ json: [] }));
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await mockBilling(page);
});

test('late invoice responses cannot overwrite a newly selected party', async ({ page }) => {
  let releaseOld!: () => void;
  const oldResponse = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  let oldRequested = false;
  await page.route('**/api/v1/billing/payments/open-invoices?**', async (r) => {
    const id = new URL(r.request().url()).searchParams.get('partyId');
    if (id === customer.id) {
      oldRequested = true;
      await oldResponse;
      return r.fulfill({ json: [openInvoice] });
    }
    return r.fulfill({
      json: [{ ...openInvoice, id: 'second-invoice', invoiceNumber: 'CI-SECOND' }],
    });
  });
  await page.route('**/api/v1/transportation/customers**', (r) =>
    r.fulfill({
      json: new URL(r.request().url()).pathname.endsWith('/customers')
        ? { items: [{ id: 'second-customer', name: 'Second client' }], total: 1 }
        : { id: 'second-customer', name: 'Second client' },
    }),
  );
  await page.goto(`/billing/payments/new?party=${customer.id}`);
  await expect.poll(() => oldRequested).toBe(true);
  await page.getByRole('button', { name: /^Client :/ }).click();
  const picker = page.getByRole('dialog', { name: 'Client', exact: true });
  await picker.getByRole('option', { name: 'Second client', exact: true }).click();
  await expect(page.getByLabel('Allocation · CI-SECOND', { exact: true })).toBeVisible();
  const oldFinished = page.waitForResponse(
    (r) =>
      r.url().includes('/open-invoices?') &&
      new URL(r.url()).searchParams.get('partyId') === customer.id,
  );
  releaseOld();
  await oldFinished;
  await expect(page.getByLabel('Allocation · CI-SECOND', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Allocation · CI-UI-1', { exact: true })).toHaveCount(0);
});

test('unavailable invoices are shown as an error, not an empty account, and retry recovers', async ({
  page,
}) => {
  let attempts = 0;
  await page.route('**/api/v1/billing/payments/open-invoices?**', (r) => {
    attempts++;
    return r.fulfill(
      attempts === 1
        ? { status: 503, json: { message: 'Factures temporairement indisponibles.' } }
        : { json: [openInvoice] },
    );
  });
  await page.goto(`/billing/payments/new?party=${customer.id}`);
  await expect(page.getByRole('alert')).toContainText('Factures temporairement indisponibles');
  await expect(page.getByText('Aucune facture à régler', { exact: true })).toHaveCount(0);
  await page.getByRole('alert').getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByLabel('Allocation · CI-UI-1', { exact: true })).toHaveValue('0');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('cancelling a posted payment requires confirmation and cancellation of the dialog sends nothing', async ({
  page,
}) => {
  let writes = 0;
  await page.route('**/api/v1/billing/payments/billing-payment', (r) =>
    r.fulfill({ json: { ...draft, status: 'SUBMITTED' } }),
  );
  await page.route('**/api/v1/billing/payments/billing-payment/cancel', (r) => {
    writes++;
    return r.fulfill({ json: { ...draft, status: 'CANCELLED' } });
  });
  await page.goto('/billing/payments/billing-payment');
  await page.getByRole('button', { name: 'Annuler le paiement', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Annuler le paiement ?', exact: true });
  await expect(confirm).toContainText('contre-écriture');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(writes).toBe(0);
  await expect(page.locator('header').getByText('Comptabilisé')).toBeVisible();
});

test('list displays parties, mode objects, real links and currency-separated posted allocations', async ({
  page,
}) => {
  await page.route('**/api/v1/billing/payments', (r) =>
    r.fulfill({
      json: [
        draft,
        {
          ...draft,
          id: 'usd-payment',
          paymentNumber: 'PAY-USD',
          status: 'SUBMITTED',
          currency: 'USD',
          totalAmount: '990',
        },
        { ...draft, id: 'cad-payment', paymentNumber: 'PAY-CAD', status: 'SUBMITTED', type: 'PAY' },
      ],
    }),
  );
  await page.goto('/billing/payments');
  await expect(page.getByText('[object Object]')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Virement bancaire' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: /Atelier Boréal/ }).first()).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Montants comptabilisés dans cette vue' }),
  ).toContainText('USD');
  await expect(
    page.getByRole('region', { name: 'Montants comptabilisés dans cette vue' }),
  ).not.toContainText('990');
  await page.getByLabel('Rechercher un paiement').fill('PAY-UI-1');
  await expect(page.getByRole('link', { name: 'PAY-USD', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'PAY-UI-1', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PAY-UI-1');
});

test('creation selects explicitly, resets on currency change, and saves only one draft', async ({
  page,
}) => {
  let creates = 0,
    submits = 0;
  await page.route('**/api/v1/billing/payments', (r) => {
    if (r.request().method() !== 'POST') return r.fulfill({ json: [] });
    creates++;
    const body = r.request().postDataJSON();
    expect(body.currency).toBe('USD');
    expect(body.allocations).toEqual([
      { targetType: 'CUSTOMER_INVOICE', targetId: 'usd-invoice', amount: 30 },
    ]);
    return r.fulfill({ json: { id: draft.id } });
  });
  await page.route('**/api/v1/billing/payments/*/submit', (r) => {
    submits++;
    return r.fulfill({ json: draft });
  });
  await page.goto(`/billing/payments/new?party=${customer.id}`);
  await expect(page.getByLabel('Allocation · CI-UI-1', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Allouer le solde de CI-UI-1', exact: true }).click();
  await expect(page.getByLabel('Allocation · CI-UI-1', { exact: true })).toHaveValue('120');
  await page.getByRole('combobox', { name: 'Devise', exact: true }).selectOption('USD');
  await expect(page.getByLabel('Allocation · CI-USD', { exact: true })).toHaveValue('0');
  await page.getByLabel('Allocation · CI-USD', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }).click();
  await expect(page).toHaveURL(/\/billing\/payments\/billing-payment$/);
  expect(creates).toBe(1);
  expect(submits).toBe(0);
});

test('a linked invoice preselects only itself and client search is not limited to the first 100', async ({
  page,
}) => {
  await page.goto(`/billing/payments/new?party=${customer.id}&target=${statement.id}`);
  await expect(page.getByLabel('Allocation · CI-UI-1', { exact: true })).toHaveValue('120');
  await page.getByRole('button', { name: 'Client : Atelier Boréal' }).click();
  const picker = page.getByRole('dialog', { name: 'Client', exact: true });
  const request = page.waitForRequest(
    (r) => r.url().includes('/transportation/customers?') && r.url().includes('search=Bor'),
  );
  await picker.getByLabel('Rechercher : client').fill('Bor');
  expect(new URL((await request).url()).searchParams.get('pageSize')).toBe('20');
  await picker.getByRole('option', { name: 'Atelier Boréal', exact: true }).click();
  await expect(picker).toHaveCount(0);
});

test('submit failure stays on the saved draft and retries that same payment after confirmation', async ({
  page,
}) => {
  let submissions = 0,
    creates = 0;
  await page.route('**/api/v1/billing/payments', (r) => {
    if (r.request().method() === 'POST') creates++;
    return r.fulfill({ json: [] });
  });
  await page.route('**/api/v1/billing/payments/billing-payment/submit', (r) => {
    submissions++;
    return r.fulfill(
      submissions === 1
        ? { status: 409, json: { message: 'Solde modifié : vérifiez les allocations.' } }
        : { json: { ...draft, status: 'SUBMITTED' } },
    );
  });
  await page.goto('/billing/payments/billing-payment');
  await page.getByRole('button', { name: 'Comptabiliser', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Comptabiliser le paiement ?' });
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submissions).toBe(0);
  for (let n = 0; n < 2; n++) {
    await page.getByRole('button', { name: 'Comptabiliser', exact: true }).click();
    await dialog.getByRole('button', { name: 'Comptabiliser', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (n === 0) await expect(page.getByRole('alert')).toContainText('Solde modifié');
  }
  await expect(page.locator('header').getByText('Comptabilisé')).toBeVisible();
  expect(submissions).toBe(2);
  expect(creates).toBe(0);
});

test('draft editor preserves errors and requires a decision before discarding changes', async ({
  page,
}) => {
  let writes = 0;
  await page.route('**/api/v1/billing/payments/billing-payment', (r) => {
    if (r.request().method() !== 'PATCH') return r.fulfill({ json: draft });
    writes++;
    return r.fulfill({ status: 503, json: { message: 'Sauvegarde simulée indisponible.' } });
  });
  await page.goto('/billing/payments/billing-payment');
  const open = page.getByRole('button', { name: 'Modifier le brouillon', exact: true });
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'Modifier le brouillon', exact: true });
  await drawer.getByLabel('Référence', { exact: true }).fill('VIR-CORRIGÉ');
  await drawer.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await expect(drawer.getByRole('alert')).toContainText('Sauvegarde simulée');
  await expect(drawer.getByLabel('Référence', { exact: true })).toHaveValue('VIR-CORRIGÉ');
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog', { name: 'Abandonner les modifications ?' });
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: 'Abandonner', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(open).toBeFocused();
  expect(writes).toBe(1);
});

for (const family of ['invoice', 'statement'] as const) {
  test(`${family}: deep-linked drawer preserves workspace width and connects sources to payments`, async ({
    page,
  }) => {
    // Empty list forces the link to resolve a record outside the first list page.
    await page.route(
      `**/api/v1/billing/${family === 'invoice' ? 'invoices' : 'customer-invoices'}`,
      (r) => r.fulfill({ json: [] }),
    );
    await page.goto(`/invoices?${family}=billing-${family}`);
    const drawer = page.getByRole('dialog', {
      name: family === 'invoice' ? 'INV-UI-1' : 'CI-UI-1',
      exact: true,
    });
    await expect(drawer).toBeVisible();
    const width = (await page.locator('#workspace-content').boundingBox())!.width;
    await expect(
      drawer.getByRole('link', { name: family === 'invoice' ? 'LD-UI-1' : 'TO-UI-1', exact: true }),
    ).toHaveAttribute(
      'href',
      family === 'invoice' ? '/loads/load-ui' : '/transport-orders/order-ui',
    );
    await expect(drawer.getByRole('link', { name: /Préparer un/ })).toHaveAttribute(
      'href',
      new RegExp(`target=billing-${family}`),
    );
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    expect(
      Math.abs((await page.locator('#workspace-content').boundingBox())!.width - width),
    ).toBeLessThan(2);
  });
}

test('invoice reconciliation draft is preserved when close is cancelled', async ({ page }) => {
  await page.route('**/api/v1/billing/tax-templates**', (r) =>
    r.fulfill({ json: [{ id: 'tax-ui', name: 'Taxe de test' }] }),
  );
  await page.route('**/api/v1/billing/invoices/billing-invoice/tax', (r) =>
    r.fulfill({ json: { ...invoice, taxTemplateId: 'tax-ui' } }),
  );
  await page.route('**/api/v1/billing/invoices', (r) =>
    r.fulfill({ json: [{ ...invoice, status: 'DRAFT' }] }),
  );
  await page.goto('/invoices');
  const open = page.getByRole('button', { name: 'INV-UI-1', exact: true });
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'INV-UI-1', exact: true });
  await drawer.getByLabel('Montant facturé · Trajet Québec').fill('135');
  const taxSaved = page.waitForResponse('**/api/v1/billing/invoices/billing-invoice/tax');
  await drawer
    .getByRole('combobox', { name: 'Gabarit de taxe', exact: true })
    .selectOption('tax-ui');
  await taxSaved;
  await expect(drawer.getByLabel('Montant facturé · Trajet Québec')).toBeEnabled();
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog', { name: 'Fermer sans enregistrer ?' });
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(drawer.getByLabel('Montant facturé · Trajet Québec')).toHaveValue('135');
});

for (const path of [
  '/billing/payments',
  '/billing/payments/new?party=billing-customer',
  '/billing/payments/billing-payment',
  '/invoices?invoice=billing-invoice',
]) {
  test(`mobile contained layout: ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    if (path.startsWith('/invoices'))
      await expect(page.getByRole('dialog', { name: 'INV-UI-1', exact: true })).toBeVisible();
    else if (path.includes('/new'))
      await expect(page.getByLabel('Allocation · CI-UI-1', { exact: true })).toBeVisible();
    else if (path.endsWith('billing-payment'))
      await expect(page.getByRole('link', { name: 'CI-UI-1' })).toBeVisible();
    else await expect(page.getByRole('link', { name: 'PAY-UI-1' })).toBeVisible();
    await page.screenshot({
      path: `playwright-artifacts/billing-${path.includes('invoices') ? 'invoice' : path.includes('/new') ? 'new' : path.endsWith('billing-payment') ? 'record' : 'list'}-mobile.png`,
      animations: 'disabled',
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    for (const box of await page.getByRole('dialog').all())
      expect((await box.boundingBox())!.width).toBeLessThanOrEqual(390.01);
  });
}
