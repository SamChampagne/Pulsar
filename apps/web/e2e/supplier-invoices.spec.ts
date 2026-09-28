import { test, expect } from './fixtures';
import { login } from './helpers';

const tenant = process.env.SUPPLIER_INVOICES_TENANT;
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
const base = '/api/v1/billing/supplier-invoices';
test.describe('Supplier invoices I2l.1', () => {
  test.skip(!tenant, 'Requires an isolated supplier-invoice HTTP fixture.');
  test('standalone entry, lost responses, exact recovery, evidence and immutable qualification on desktop/mobile', async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const auth = await page.request.post('/api/v1/auth/login', { data: credentials() });
    expect(auth.ok()).toBeTruthy();
    const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
    const supplierName = `Supplier UI ${Date.now()}`;
    const supplier = await page.request.post('/api/v1/billing/data/suppliers', {
      headers,
      data: { code: crypto.randomUUID(), name: supplierName },
    });
    expect(supplier.ok()).toBeTruthy();
    await login(page, credentials());
    await page.goto('/billing/supplier-invoices');
    await expect(
      page.getByRole('heading', { name: 'Factures fournisseur', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Saisir une facture', exact: true }).click();
    await page.getByRole('button', { name: /^Fournisseur :/ }).click();
    await page
      .getByRole('textbox', { name: 'Rechercher : fournisseur', exact: true })
      .fill(supplierName);
    await page.getByRole('option', { name: new RegExp(supplierName) }).click();
    const external = `UI-${Date.now()}`;
    await page.getByLabel('Numéro de la facture reçue', { exact: true }).fill(external);
    await page.getByLabel('Date de facture (date civile)', { exact: true }).fill('2026-09-26');
    await page.getByLabel('Description ligne 1', { exact: true }).fill('Entretien terrain');
    await page.getByLabel('Quantité ligne 1', { exact: true }).fill('1.25');
    await page.getByLabel('Unité ligne 1', { exact: true }).fill('H');
    await page.getByLabel('Net ligne 1 (CAD)', { exact: true }).fill('10.10');
    await page.getByRole('button', { name: 'Ajouter une taxe déclarée' }).click();
    await page.getByLabel('Libellé taxe 1', { exact: true }).fill('Taxe déclarée');
    await page.getByLabel('Montant taxe 1', { exact: true }).fill('0.25');
    await expect(page.getByText('Total déclaré : 10.35 CAD', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = page.getByRole('dialog', { name: /Saisir une facture fournisseur/ });
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await page.screenshot({
      path: info.outputPath('supplier-invoice-form-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    let attempts = 0,
      body = '',
      id = '',
      number = '';
    await page.route(`**${base}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts++;
      const exact = route.request().postData()!;
      if (attempts === 1) {
        body = exact;
        const r = await route.fetch();
        expect(r.ok()).toBeTruthy();
        id = (await r.json()).id;
        return route.fulfill({
          status: 503,
          json: { message: 'Réponse perdue après enregistrement' },
        });
      }
      expect(exact).toBe(body);
      if (attempts === 2)
        return route.fulfill({ status: 403, json: { message: 'Refus intermédiaire simulé' } });
      const r = await route.fetch();
      expect((await r.json()).replayed).toBe(true);
      return route.fulfill({ response: r });
    });
    await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Réponse perdue');
    await page.getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Refus intermédiaire');
    await page.reload();
    await page.getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }),
    ).toBeVisible();
    expect(attempts).toBe(3);
    const r = await page.request.get(`${base}/${id}`, { headers });
    number = (await r.json()).number;
    await page
      .getByLabel('Notes de vérification', { exact: true })
      .fill('Montants relus par le service comptable');
    await expect(
      page.getByRole('button', { name: 'Préparer la qualification', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Préparer la qualification', exact: true }),
    ).toBeEnabled();
    await page.getByLabel('Fichier justificatif (PDF, PNG, JPEG)', { exact: true }).setInputFiles({
      name: 'original-fournisseur.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nSupplier invoice\n%%EOF'),
    });
    await page
      .getByLabel('Description du justificatif', { exact: true })
      .fill('Facture originale reçue du fournisseur');
    await page.getByRole('button', { name: 'Conserver le justificatif', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Télécharger original-fournisseur.pdf', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Préparer la qualification', exact: true }).click();
    const original = page.getByRole('combobox', { name: 'Document original reçu', exact: true });
    await original.selectOption({ index: 1 });
    await page
      .getByLabel('Compte rendu de vérification', { exact: true })
      .fill('Fournisseur, lignes et montants conformes au document reçu.');
    await page.getByRole('checkbox', { name: /J’ai vérifié le fournisseur/ }).check();
    let closeAttempts = 0;
    await page.route(`**${base}/${id}/qualify`, async (route) => {
      closeAttempts++;
      const r = await route.fetch();
      expect(r.ok()).toBeTruthy();
      return route.fulfill({
        status: 503,
        json: { message: 'Qualification enregistrée, réponse perdue' },
      });
    });
    await page.getByRole('button', { name: 'Confirmer la qualification', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('réponse perdue');
    await page.reload();
    await page.getByRole('button', { name: 'Vérifier la demande', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: new RegExp(`${number}.*Qualifiée`) }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Original : original-fournisseur.pdf', { exact: true }),
    ).toBeVisible();
    expect(closeAttempts).toBe(1);
    await page.screenshot({
      path: info.outputPath('supplier-invoice-qualified-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.getByRole('dialog').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath('supplier-invoice-qualified-mobile.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
  test('reader sees evidence and the document without mutation controls', async ({ page }) => {
    test.setTimeout(60000);
    await login(page, credentials('reader'));
    // Finish the legacy dashboard's own requests before observing the Finance page.
    await page.waitForLoadState('networkidle');
    const denied: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 403) denied.push(r.url());
    });
    await page.goto('/finance');
    await expect(
      page.getByRole('link', { name: 'Ouvrir le registre fournisseur', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Clients et transporteurs', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('link', { name: 'Ouvrir le registre fournisseur', exact: true }).click();
    await page.goto('/billing/supplier-invoices');
    await expect(
      page.getByRole('heading', { name: 'Factures fournisseur', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Saisir une facture', exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole('button', { name: /^Ouvrir FF-/ })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: 'Historique récent', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Préparer la qualification', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Conserver le justificatif', exact: true }),
    ).toHaveCount(0);
    expect(denied).toEqual([]);
  });
  test('explicit purchase line selection preserves declared amounts and source context', async ({
    page,
  }) => {
    const linkedTenant = process.env.SUPPLIER_INVOICES_LINKED_TENANT;
    page.on('pageerror', (error) => {
      throw error;
    });
    test.skip(!linkedTenant, 'Requires linked purchase fixture.');
    test.setTimeout(90000);
    const creds = {
      tenant: linkedTenant!,
      email: `manager@${linkedTenant}.test`,
      password: 'Test1234!',
    };
    const auth = await page.request.post('/api/v1/auth/login', { data: creds });
    expect(auth.ok()).toBeTruthy();
    const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
    async function post(path: string, data: object) {
      const r = await page.request.post(`/api/v1/${path}`, { headers, data });
      expect(r.ok(), await r.text()).toBeTruthy();
      return r.json();
    }
    const supplier = await post('billing/data/suppliers', {
      code: crypto.randomUUID(),
      name: `Supplier linked UI ${Date.now()}`,
    });
    const item = await post('purchasing/data/items', {
      code: crypto.randomUUID(),
      name: 'Conseil spécialisé',
      kind: 'SERVICE',
      unit: 'H',
    });
    const draft = await post('purchasing/orders', {
      supplierId: supplier.id,
      currency: 'CAD',
      lines: [{ catalogItemId: item.id, quantity: 3, unitPrice: 10 }],
    });
    const order = await post(`purchasing/orders/${draft.id}/transition`, {
      status: 'CONFIRMED',
      expectedUpdatedAt: draft.updatedAt,
    });
    const made = await post('billing/supplier-invoices', {
      operationKey: crypto.randomUUID(),
      supplierId: supplier.id,
      externalNumber: crypto.randomUUID(),
      invoiceDate: '2026-09-26',
      currency: 'CAD',
      notes: '',
      lines: [{ description: 'Conseil reçu', quantity: '2', unit: 'H', netAmount: '19.90' }],
      taxes: [],
    });
    const r = await page.request.get(`${base}/${made.id}`, { headers }),
      invoice = await r.json();
    await login(page, creds);
    await page.goto('/billing/supplier-invoices');
    await page.route(
      `**${base}/${made.id}`,
      (route) =>
        route.fulfill({ status: 503, json: { message: 'Lecture temporairement indisponible' } }),
      { times: 1 },
    );
    await page.getByRole('button', { name: `Ouvrir ${invoice.number}`, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Lecture temporairement indisponible');
    await expect(page.getByRole('button', { name: 'Créer le brouillon', exact: true })).toHaveCount(
      0,
    );
    await page.getByRole('button', { name: 'Recharger le dossier', exact: true }).click();
    await page.getByRole('button', { name: /^Ligne d’achat liée 1/ }).click();
    await page.getByRole('option', { name: new RegExp(order.number) }).click();
    await expect(page.getByLabel('Net ligne 1 (CAD)', { exact: true })).toHaveValue('19.9');
    await page.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }).click();
    await expect(
      page.getByRole('button', { name: new RegExp(`Ligne d’achat liée 1.*${order.number}`) }),
    ).toBeVisible();
    const saved = await page.request.get(`${base}/${made.id}`, { headers });
    const view = await saved.json();
    expect(view.totalAmount).toBe('19.9');
    expect(view.lines[0].purchaseSnapshot.unitPrice).toBe('10');
    expect(view.lines[0].purchaseSnapshot.quantity).toBe('3');
  });
  test('first-use supplier tutorial is specific and persists once for an isolated new user', async ({
    page,
  }) => {
    test.setTimeout(60000);
    const auth = await page.request.post('/api/v1/auth/login', { data: credentials() });
    const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
    const roleResponse = await page.request.get('/api/v1/roles', { headers });
    const roles = await roleResponse.json();
    const role = (Array.isArray(roles) ? roles : roles.items).find(
      (r: { key: string }) => r.key === 'writer',
    );
    expect(role).toBeTruthy();
    const creds = {
      tenant: tenant!,
      email: `invoice-tour-${Date.now()}@example.test`,
      password: 'Test1234!',
    };
    const user = await page.request.post('/api/v1/users', {
      headers,
      data: {
        email: creds.email,
        password: creds.password,
        firstName: 'Tutoriel',
        lastName: 'Facture isolée',
        roleIds: [role.id],
      },
    });
    expect(user.ok(), await user.text()).toBeTruthy();
    await login(page, creds);
    await page.unroute('**/api/v1/me/preferences');
    await page.goto('/billing/supplier-invoices');
    // page.goto loaded a fresh shell using the actual new user's preferences.
    const tour = page.getByTestId('module-tour');
    await expect(tour).toContainText('Conserver une facture reçue du fournisseur');
    await expect(tour).toContainText('pas payée ou comptabilisée');
    await tour.getByRole('button', { name: 'Passer le tutoriel', exact: true }).click();
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Factures fournisseur', exact: true }),
    ).toBeVisible();
    await expect(tour).toHaveCount(0);
  });
});
