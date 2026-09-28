import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.SUPPLIER_SCHEDULES_TENANT;
const credentials = (role = 'planner') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
const base = '/api/v1/billing/supplier-schedules',
  invoices = '/api/v1/billing/supplier-invoices';
test.describe('Supplier schedules I2m.1', () => {
  test.skip(!tenant, 'Requires isolated supplier-schedule HTTP fixtures.');
  async function fixture(page: any) {
    const auth = await page.request.post('/api/v1/auth/login', { data: credentials('manager') });
    expect(auth.ok()).toBeTruthy();
    const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
    const supplier = await page.request.post('/api/v1/billing/data/suppliers', {
      headers,
      data: { code: crypto.randomUUID(), name: 'Fournisseur échéances UI' },
    });
    expect(supplier.ok()).toBeTruthy();
    const supplierId = (await supplier.json()).id;
    const made = await page.request.post(invoices, {
      headers,
      data: {
        operationKey: crypto.randomUUID(),
        supplierId,
        externalNumber: `UI-${crypto.randomUUID()}`,
        invoiceDate: '2026-09-26',
        dueDate: '2026-10-26',
        currency: 'CAD',
        notes: '',
        lines: [{ description: 'Prestation', quantity: '1', unit: 'H', netAmount: '10.10' }],
        taxes: [{ label: 'Taxe déclarée', amount: '0.25' }],
      },
    });
    expect(made.ok()).toBeTruthy();
    const id = (await made.json()).id;
    const row = await qualify(page, invoices, id, headers);
    return { row, headers, supplierId };
  }
  async function qualify(page: any, family: string, id: string, headers: any) {
    const row = await (await page.request.get(`${family}/${id}`, { headers })).json();
    const file = await page.request.post(`${family}/${id}/evidence`, {
      headers,
      multipart: {
        operationKey: crypto.randomUUID(),
        caption: 'Original UI',
        file: {
          name: 'original.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\nSupplier schedule\n%%EOF'),
        },
      },
    });
    expect(file.ok()).toBeTruthy();
    const r = await page.request.post(`${family}/${id}/qualify`, {
      headers,
      data: {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: row.updatedAt,
        evidenceId: (await file.json()).id,
        note: 'Pièce et montants relus pour test échéancier.',
      },
    });
    expect(r.ok()).toBeTruthy();
    return (await page.request.get(`${family}/${id}`, { headers })).json();
  }
  async function review(page: any, note = 'Dates convenues après échange fournisseur') {
    await page.getByLabel('Motif de la révision', { exact: true }).fill(note);
    await page.getByRole('button', { name: 'Examiner les effets', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Revue de l’échéancier' })).toBeVisible();
    await page.getByRole('checkbox', { name: /J’ai vérifié les dates/ }).check();
  }
  test('planner confirms exact dates, recovers after lost response/403/reload, withdraws and reinstates on mobile', async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const { row, headers } = await fixture(page),
      errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await login(page, credentials());
    await page.goto(`/billing/supplier-schedules?invoiceId=${row.id}`);
    await page.getByRole('button', { name: 'Ajouter une échéance', exact: true }).click();
    await page.getByLabel('Date civile échéance 1', { exact: true }).fill('2026-09-27');
    await page.getByLabel('Montant échéance 1 (CAD)', { exact: true }).fill('0.10');
    await page.getByRole('button', { name: 'Ajouter une échéance', exact: true }).click();
    await page.getByLabel('Date civile échéance 2', { exact: true }).fill('2026-10-26');
    await page.getByLabel('Montant échéance 2 (CAD)', { exact: true }).fill('10.25');
    await review(page);
    let attempts = 0,
      exact = '';
    await page.route(`**${base}/invoice/${row.id}/confirm`, async (route) => {
      attempts++;
      if (attempts === 1) {
        exact = route.request().postData()!;
        const r = await route.fetch();
        expect(r.ok()).toBeTruthy();
        return route.fulfill({
          status: 503,
          json: { message: 'Confirmation conservée, réponse perdue' },
        });
      }
      expect(route.request().postData()).toBe(exact);
      if (attempts === 2)
        return route.fulfill({ status: 403, json: { message: 'Refus intermédiaire simulé' } });
      const r = await route.fetch();
      expect((await r.json()).replayed).toBe(true);
      return route.fulfill({ response: r });
    });
    await page.getByRole('button', { name: 'Confirmer la révision', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('réponse perdue');
    await page.getByRole('button', { name: 'Reprendre la même confirmation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Refus intermédiaire');
    await page.reload();
    await page.getByRole('button', { name: 'Reprendre la même confirmation', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Révision 1 · Confirmée', exact: true }),
    ).toBeVisible();
    expect(attempts).toBe(3);
    await expect(
      page.getByText('Révision conservée. Aucun paiement ni écriture comptable.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Confirmation à vérifier', exact: true }),
    ).toHaveCount(0);
    await page.unroute(`**${base}/invoice/${row.id}/confirm`);
    await page.screenshot({
      path: info.outputPath('supplier-schedule-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = page.getByRole('dialog');
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Retirer le planning', exact: true }).click();
    await review(page, 'Retrait explicite après échange fournisseur');
    await page.getByRole('button', { name: 'Confirmer la révision', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Révision 2 · Retirée', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Reprendre l’échéance de la facture', exact: true })
      .click();
    await review(page, 'Nouvelles dates confirmées avec fournisseur');
    await page.getByRole('button', { name: 'Confirmer la révision', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Révision 3 · Confirmée', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('supplier-schedule-mobile.png'),
      fullPage: true,
    });
    const history = await (
      await page.request.get(`${base}/invoice/${row.id}/history`, { headers })
    ).json();
    expect(history.total).toBe(3);
    expect(errors).toEqual([]);
  });
  test('new credit makes the schedule stale; original dates are retained until explicit review', async ({
    page,
  }) => {
    const { row, headers, supplierId } = await fixture(page);
    await login(page, credentials());
    await page.goto(`/billing/supplier-schedules?invoiceId=${row.id}`);
    await page
      .getByRole('button', { name: 'Reprendre l’échéance de la facture', exact: true })
      .click();
    await review(page);
    await page.getByRole('button', { name: 'Confirmer la révision', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Révision 1 · Confirmée', exact: true }),
    ).toBeVisible();
    const credits = '/api/v1/billing/supplier-credits';
    const made = await page.request.post(credits, {
      headers,
      data: {
        operationKey: crypto.randomUUID(),
        invoiceId: row.id,
        externalNumber: crypto.randomUUID(),
        creditDate: '2026-09-27',
        reason: 'Réduction fournisseur après premier planning',
        lines: [{ invoiceLineId: row.lines[0].id, netAmount: '2.10' }],
        taxes: [{ position: 0, amount: '0.05' }],
      },
    });
    expect(made.ok()).toBeTruthy();
    await qualify(page, credits, (await made.json()).id, headers);
    await page.reload();
    await expect(page.getByText(/^À revoir : de nouveaux avoirs/)).toBeVisible();
    await expect(page.getByLabel('Montant échéance 1 (CAD)', { exact: true })).toHaveValue('10.35');
    await page.getByLabel('Montant échéance 1 (CAD)', { exact: true }).fill('8.20');
    await review(page);
    await page.getByRole('button', { name: 'Confirmer la révision', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Révision 2 · Confirmée', exact: true }),
    ).toBeVisible();
    await page.goto(`/billing/supplier-schedules?supplierId=${supplierId}`);
    await expect(page.getByRole('region', { name: 'Prévision CAD', exact: true })).toContainText(
      '8,20 CAD',
    );
    await page.getByRole('button', { name: `Planifier ${row.number}`, exact: true }).click();
    await page.getByRole('link', { name: 'Ouvrir la facture source', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Échéancier de la facture', exact: true }),
    ).toBeVisible();
  });
  test('reader has no mutation controls, errors clear stale totals, date filters and mobile list remain usable', async ({
    page,
  }, info) => {
    const { row, headers, supplierId } = await fixture(page);
    const input = {
      status: 'CONFIRMED',
      note: 'Planning préparé pour lecture seule',
      installments: [{ dueDate: '2026-10-26', amount: '10.35', note: '' }],
    };
    const reviewed = await (
      await page.request.post(`${base}/invoice/${row.id}/review`, { headers, data: input })
    ).json();
    const confirmed = await page.request.post(`${base}/invoice/${row.id}/confirm`, {
      headers,
      data: {
        ...reviewed.input,
        reviewToken: reviewed.reviewToken,
        expectedRevisionId: reviewed.expectedRevisionId,
        confirmed: true,
        operationKey: crypto.randomUUID(),
      },
    });
    expect(confirmed.ok()).toBeTruthy();
    await login(page, credentials('reader'));
    await page.goto(`/billing/supplier-schedules?supplierId=${supplierId}`);
    await page.getByLabel('Date de référence', { exact: true }).fill('2026-11-01');
    await page.getByRole('button', { name: 'Appliquer', exact: true }).click();
    const forecast = page.getByRole('region', { name: 'Prévision CAD', exact: true });
    await expect(forecast).toContainText('Dates dépassées');
    await expect(forecast).toContainText('10,35 CAD');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('supplier-schedule-list-mobile.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: `Consulter ${row.number}`, exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('supplier-schedule-list-cards-mobile.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: `Consulter ${row.number}`, exact: true }).click();
    await expect(page.getByText(/^Lecture seule. Le droit de gestion/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Examiner les effets', exact: true }),
    ).toHaveCount(0);
    await page.goto(`/billing/supplier-schedules?supplierId=${supplierId}`);
    await expect(forecast).toBeVisible();
    await page.route(`**${base}?**`, (route) =>
      route.fulfill({ status: 503, json: { message: 'Prévision indisponible' } }),
    );
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Prévision indisponible');
    await expect(forecast).toHaveCount(0);
    await page.unroute(`**${base}?**`);
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(forecast).toBeVisible();
  });
});
