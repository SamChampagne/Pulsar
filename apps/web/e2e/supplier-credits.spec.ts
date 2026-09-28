import { test, expect } from './fixtures';
import { login } from './helpers';
import type { Page } from '@playwright/test';
const tenant = process.env.SUPPLIER_CREDITS_TENANT;
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
const base = '/api/v1/billing/supplier-credits',
  invoices = '/api/v1/billing/supplier-invoices';
async function fixture(page: Page) {
  const auth = await page.request.post('/api/v1/auth/login', { data: credentials() });
  expect(auth.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
  const supplier = await page.request.post('/api/v1/billing/data/suppliers', {
    headers,
    data: { code: crypto.randomUUID(), name: 'Atelier test avoir UI' },
  });
  expect(supplier.ok()).toBeTruthy();
  const external = `UI-AV-SOURCE-${Date.now()}`;
  const made = await page.request.post(invoices, {
    headers,
    data: {
      operationKey: crypto.randomUUID(),
      supplierId: (await supplier.json()).id,
      externalNumber: external,
      invoiceDate: '2026-09-26',
      currency: 'CAD',
      notes: 'Source du scénario navigateur',
      lines: [{ description: 'Entretien sur site', quantity: '1', unit: 'H', netAmount: '10.10' }],
      taxes: [{ label: 'Taxe déclarée', amount: '0.25' }],
    },
  });
  expect(made.ok()).toBeTruthy();
  const id = (await made.json()).id,
    r = await page.request.get(`${invoices}/${id}`, { headers }),
    row = await r.json();
  const e = await page.request.post(`${invoices}/${id}/evidence`, {
    headers,
    multipart: {
      operationKey: crypto.randomUUID(),
      caption: 'Original fournisseur',
      file: {
        name: 'source.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nSource\n%%EOF'),
      },
    },
  });
  expect(e.ok()).toBeTruthy();
  expect(
    (
      await page.request.post(`${invoices}/${id}/qualify`, {
        headers,
        data: {
          operationKey: crypto.randomUUID(),
          expectedUpdatedAt: row.updatedAt,
          evidenceId: (await e.json()).id,
          note: 'Original reçu et montants relus',
        },
      })
    ).ok(),
  ).toBeTruthy();
  return { id, number: row.number, external, headers, row };
}
async function openInvoice(page: Page, number: string, external: string) {
  await page.goto('/billing/supplier-invoices');
  await page.getByLabel('Rechercher une facture', { exact: true }).fill(external);
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await page.getByRole('button', { name: `Ouvrir ${number}`, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Avoirs fournisseur', exact: true }),
  ).toBeVisible();
}
test.describe('Supplier credits I2l.2', () => {
  test.skip(!tenant, 'Requires isolated supplier-credit HTTP fixtures.');
  test('partial credit, lost responses, original and frozen balance on desktop/mobile', async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    page.on('pageerror', (e) => {
      throw e;
    });
    const f = await fixture(page);
    await login(page, credentials());
    await openInvoice(page, f.number, f.external);
    const section = page.getByRole('region', { name: 'Avoirs fournisseur', exact: true });
    await section.getByRole('button', { name: 'Saisir un avoir reçu', exact: true }).click();
    await section
      .getByLabel('Numéro de l’avoir fournisseur', { exact: true })
      .fill(`AV-UI-${Date.now()}`);
    await section.getByLabel('Date de l’avoir', { exact: true }).fill('2026-09-27');
    await section
      .getByLabel('Motif de l’avoir', { exact: true })
      .fill('Remise commerciale reçue après vérification');
    await section.getByLabel('Crédit net — Entretien sur site', { exact: true }).fill('4.10');
    await section.getByLabel('Crédit taxe 1 — Taxe déclarée', { exact: true }).fill('0.10');
    await expect(section.getByText('Total de l’avoir : 4.20 CAD', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.getByRole('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    await section.getByLabel('Motif de l’avoir').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('supplier-credit-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    let attempts = 0,
      exact = '',
      creditId = '';
    await page.route(`**${base}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts++;
      if (attempts === 1) {
        exact = route.request().postData()!;
        const r = await route.fetch();
        expect(r.ok()).toBeTruthy();
        creditId = (await r.json()).id;
        return route.fulfill({ status: 503, json: { message: 'Réponse d’avoir perdue' } });
      }
      expect(route.request().postData()).toBe(exact);
      if (attempts === 2)
        return route.fulfill({ status: 403, json: { message: 'Refus intermédiaire' } });
      const r = await route.fetch();
      expect((await r.json()).replayed).toBe(true);
      return route.fulfill({ response: r });
    });
    await section.getByRole('button', { name: 'Créer le brouillon d’avoir', exact: true }).click();
    await expect(section.getByRole('alert')).toContainText('perdue');
    await section.getByRole('button', { name: 'Reprendre le même avoir' }).click();
    await expect(section.getByRole('alert')).toContainText('intermédiaire');
    await page.reload();
    await openInvoice(page, f.number, f.external);
    await section.getByRole('button', { name: 'Reprendre le même avoir' }).click();
    await expect(
      section.getByRole('button', { name: 'Enregistrer l’avoir', exact: true }),
    ).toBeVisible();
    expect(attempts).toBe(3);
    await section.getByLabel('Motif de l’avoir').fill('Remise relue avec responsable des achats');
    await expect(
      section.getByRole('button', { name: 'Préparer la qualification de l’avoir' }),
    ).toBeDisabled();
    await section.getByRole('button', { name: 'Enregistrer l’avoir', exact: true }).click();
    await expect(
      section.getByRole('button', { name: 'Préparer la qualification de l’avoir' }),
    ).toBeEnabled();
    await expect(
      section.getByLabel('Fichier justificatif (PDF, PNG, JPEG)', { exact: true }),
    ).toBeEnabled();
    await section
      .getByLabel('Fichier justificatif (PDF, PNG, JPEG)', { exact: true })
      .setInputFiles({
        name: 'avoir-original.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nCredit received\n%%EOF'),
      });
    await section
      .getByLabel('Description du justificatif', { exact: true })
      .fill('Original de l’avoir reçu');
    await section.getByRole('button', { name: 'Conserver le justificatif', exact: true }).click();
    await expect(
      section.getByRole('button', { name: 'Télécharger avoir-original.pdf' }),
    ).toBeVisible();
    await section.getByRole('button', { name: 'Préparer la qualification de l’avoir' }).click();
    await section
      .getByRole('combobox', { name: 'Original de l’avoir reçu', exact: true })
      .selectOption({ index: 1 });
    await section
      .getByLabel('Compte rendu de l’avoir', { exact: true })
      .fill('Net, taxes et document original contrôlés.');
    await section.getByRole('checkbox', { name: /Je confirme les montants/ }).check();
    let closes = 0;
    await page.route(`**${base}/${creditId}/qualify`, async (route) => {
      closes++;
      const r = await route.fetch();
      expect(r.ok()).toBeTruthy();
      return route.fulfill({ status: 503, json: { message: 'Qualification perdue après commit' } });
    });
    await section.getByRole('button', { name: 'Confirmer l’avoir qualifié', exact: true }).click();
    await expect(section.getByRole('alert')).toContainText('après commit');
    await page.reload();
    await openInvoice(page, f.number, f.external);
    await section.getByRole('button', { name: 'Vérifier la demande d’avoir' }).click();
    await expect(section.getByRole('heading', { name: /^AVF-.*Qualifié — figé$/ })).toBeVisible();
    await expect(
      section.getByRole('button', { name: 'Télécharger avoir-original.pdf' }),
    ).toBeVisible();
    await expect(section.getByRole('button', { name: 'Saisir un avoir reçu' })).toBeEnabled();
    await expect(
      section.getByRole('button', { name: 'Enregistrer l’avoir', exact: true }),
    ).toHaveCount(0);
    await expect(section.getByText('6.15 CAD', { exact: true })).toBeVisible();
    expect(closes).toBe(1);
    await section
      .getByRole('heading', { name: 'Avoirs fournisseur', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('supplier-credit-qualified-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.getByRole('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('supplier-credit-qualified-mobile.png'),
      fullPage: true,
    });
    const source = await page.request.get(`${invoices}/${f.id}`, { headers: f.headers });
    expect((await source.json()).totalAmount).toBe('10.35');
  });
  test('selects an explicit WMS report without calculating a credit from accepted quantities', async ({
    page,
  }) => {
    const linked = process.env.SUPPLIER_CREDITS_LINKED_TENANT;
    test.skip(!linked, 'Requires linked isolated fixture.');
    page.on('pageerror', (e) => {
      throw e;
    });
    const creds = { tenant: linked!, email: `manager@${linked}.test`, password: 'Test1234!' };
    const auth = await page.request.post('/api/v1/auth/login', { data: creds });
    expect(auth.ok()).toBeTruthy();
    const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
    const list = await page.request.get(`${invoices}?pageSize=100`, { headers });
    expect(list.ok()).toBeTruthy();
    let source: { id: string; number: string; externalNumber: string } | undefined,
      report: { id: string; name: string } | undefined;
    for (const r of (await list.json()).items.filter(
      (r: { status: string }) => r.status === 'QUALIFIED',
    )) {
      const response = await page.request.get(`${base}/returns/${r.id}`, { headers });
      expect(response.ok()).toBeTruthy();
      const reports = (await response.json()).items;
      if (reports.length) {
        source = r;
        report = reports[0];
        break;
      }
    }
    expect(source).toBeTruthy();
    expect(report).toBeTruthy();
    await login(page, creds);
    await openInvoice(page, source!.number, source!.externalNumber);
    const section = page.getByRole('region', { name: 'Avoirs fournisseur', exact: true });
    await section.getByRole('button', { name: 'Saisir un avoir reçu' }).click();
    await section
      .getByLabel('Numéro de l’avoir fournisseur', { exact: true })
      .fill(`AV-LINK-${Date.now()}`);
    await section.getByLabel('Date de l’avoir', { exact: true }).fill('2026-09-27');
    await section
      .getByLabel('Motif de l’avoir', { exact: true })
      .fill('Montant déclaré distinct des quantités acceptées');
    await section.getByLabel('Crédit net — Entretien', { exact: true }).fill('0.05');
    await section.getByRole('button', { name: /^Suivi de retour WMS \(facultatif\) :/ }).click();
    await page.getByRole('option').filter({ hasText: report!.name }).click();
    await expect(section.getByText('Total de l’avoir : 0.05 CAD', { exact: true })).toBeVisible();
    await section.getByRole('button', { name: 'Créer le brouillon d’avoir' }).click();
    await expect(section.getByText(/Contexte capturé : SX-/)).toBeVisible();
    await expect(
      section.getByRole('button', { name: 'Enregistrer l’avoir', exact: true }),
    ).toBeEnabled();
    await expect(section.getByLabel('Crédit net — Entretien', { exact: true })).toHaveValue('0.05');
  });
  test('reader sees documentary balance and evidence but no mutations', async ({ page }) => {
    const f = await fixture(page);
    const c = await page.request.post(base, {
      headers: f.headers,
      data: {
        operationKey: crypto.randomUUID(),
        invoiceId: f.id,
        externalNumber: `AV-READ-${Date.now()}`,
        creditDate: '2026-09-27',
        reason: 'Document à lire seulement',
        lines: [{ invoiceLineId: f.row.lines[0].id, netAmount: '1' }],
        taxes: [],
      },
    });
    expect(c.ok()).toBeTruthy();
    const row = await (
      await page.request.get(`${base}/${(await c.json()).id}`, { headers: f.headers })
    ).json();
    await login(page, credentials('reader'));
    await openInvoice(page, f.number, f.external);
    const section = page.getByRole('region', { name: 'Avoirs fournisseur', exact: true });
    await section.getByRole('button', { name: `Ouvrir ${row.number}`, exact: true }).click();
    await expect(section.getByText('Document à lire seulement', { exact: true })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Saisir un avoir reçu' })).toHaveCount(0);
    await expect(
      section.getByRole('button', { name: 'Préparer la qualification de l’avoir' }),
    ).toHaveCount(0);
    await expect(section.getByLabel('Fichier justificatif (PDF, PNG, JPEG)')).toHaveCount(0);
  });
});
