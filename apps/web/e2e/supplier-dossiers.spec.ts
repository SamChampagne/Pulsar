import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.SUPPLIER_DOSSIERS_TENANT;
const credentials = () => ({
  tenant: tenant!,
  email: `reader@${tenant}.test`,
  password: 'Test1234!',
});
const base = '/api/v1/billing/supplier-dossiers';
test.describe('Supplier dossiers I2l.3', () => {
  test.skip(!tenant, 'Requires isolated supplier-dossier HTTP fixtures.');
  async function fixture(page: any) {
    const auth = await page.request.post('/api/v1/auth/login', { data: credentials() });
    expect(auth.ok()).toBeTruthy();
    const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
    const r = await page.request.get(`${base}?search=DOSSIER`, { headers });
    expect(r.ok()).toBeTruthy();
    const supplier = (await r.json()).items.find((s: any) => s.code === 'DOSSIER');
    expect(supplier).toBeTruthy();
    const docs = await page.request.get(`${base}/${supplier.id}/documents`, { headers });
    return { supplier, rows: (await docs.json()).items, headers };
  }
  test('reader explores history, filters, exact currencies, credit deep link and original on desktop/mobile', async ({
    page,
  }, info) => {
    const { supplier, rows } = await fixture(page),
      credit = rows.find((r: any) => r.kind === 'CREDIT' && r.status === 'QUALIFIED');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await login(page, credentials());
    await page.goto('/billing/suppliers');
    await page.getByLabel('Rechercher un fournisseur', { exact: true }).fill('renommé');
    await page
      .getByRole('combobox', { name: 'Activité du fournisseur', exact: true })
      .selectOption('INACTIVE');
    await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
    await page.getByRole('link', { name: 'Ouvrir DOSSIER', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Fournisseur renommé', exact: true }),
    ).toBeVisible();
    const summary = page.getByRole('region', { name: 'Synthèse documentaire' });
    await expect(summary).toContainText('8,20 CAD');
    await expect(summary).toContainText('20,35 USD');
    await expect(summary).toContainText('n’est pas une dette à payer');
    await expect(page.getByText('Nom capturé : Fournisseur dossier').first()).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Type de document', exact: true })
      .selectOption('CREDIT');
    await page
      .getByRole('combobox', { name: 'Statut documentaire', exact: true })
      .selectOption('QUALIFIED');
    await page.getByLabel('Date du document — du', { exact: true }).fill('2026-09-27');
    await page.getByLabel('Date du document — au', { exact: true }).fill('2026-09-27');
    await page.getByRole('button', { name: 'Appliquer', exact: true }).click();
    await expect(page.getByText('1 résultat(s) · page 1', { exact: true })).toBeVisible();
    await expect(summary).toContainText('20,35 USD');
    await expect(page.getByRole('cell', { name: '2026-09-27', exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath('supplier-dossier-desktop.png'),
      fullPage: true,
    });
    await page
      .getByRole('link', { name: `Ouvrir ${credit.number}`, exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('supplier-dossier-register-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('heading', { name: 'Fournisseur renommé', exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('supplier-dossier-mobile.png'), fullPage: true });
    const mobileSummary = page.getByRole('region', { name: 'Synthèse CAD', exact: true });
    await expect(mobileSummary).toContainText('Reste documentaire');
    expect(await mobileSummary.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await page
      .getByRole('link', { name: `Ouvrir ${credit.number}`, exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('supplier-dossier-register-mobile.png'),
      fullPage: true,
    });
    await page.getByRole('link', { name: `Ouvrir ${credit.number}`, exact: true }).click();
    const panel = page.getByRole('region', { name: 'Dossier avoir fournisseur', exact: true });
    await expect(
      panel.getByRole('heading', { name: `${credit.number} · Qualifié — figé`, exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Enregistrer le brouillon', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Saisir un avoir reçu', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Télécharger avoir-dossier.pdf', exact: true }),
    ).toBeVisible();
    await page.goto(`/billing/suppliers/${supplier.id}`);
    await page.getByRole('tab', { name: 'Pièces justificatives', exact: true }).click();
    await expect(page.getByText('3 résultat(s) · page 1', { exact: true })).toBeVisible();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Télécharger avoir-dossier.pdf', exact: true }).click();
    expect((await event).suggestedFilename()).toBe('avoir-dossier.pdf');
    expect(errors).toEqual([]);
  });
  test('failed reads clear old rows and retry safely; empty filters do not imply an empty history', async ({
    page,
  }) => {
    const { supplier } = await fixture(page);
    await login(page, credentials());
    await page.goto(`/billing/suppliers/${supplier.id}`);
    await expect(page.getByText('5 résultat(s) · page 1', { exact: true })).toBeVisible();
    let fail = true;
    await page.route(`**${base}/${supplier.id}/documents?**`, (route) =>
      fail
        ? route.fulfill({ status: 503, json: { message: 'Lecture interrompue' } })
        : route.continue(),
    );
    await page.getByRole('button', { name: 'Appliquer', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Lecture interrompue');
    await expect(page.getByRole('link', { name: /^Ouvrir (FF|AVF)/ })).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect(page.getByText('5 résultat(s) · page 1', { exact: true })).toBeVisible();
    await page.getByLabel('Recherche dans le dossier', { exact: true }).fill('INEXISTANT');
    await page.getByRole('button', { name: 'Appliquer', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Aucun document trouvé', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Synthèse documentaire' })).toContainText(
      '8,20 CAD',
    );
    await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
    await expect(page.getByText('5 résultat(s) · page 1', { exact: true })).toBeVisible();
  });
  test('bad deep links never open an unrelated credit', async ({ page }) => {
    const { rows } = await fixture(page),
      credit = rows.find((r: any) => r.kind === 'CREDIT' && r.status === 'QUALIFIED'),
      other = rows.find((r: any) => r.kind === 'INVOICE' && r.currency === 'USD');
    await login(page, credentials());
    await page.goto(`/billing/supplier-invoices?invoiceId=${other.id}&creditId=${credit.id}`);
    await expect(
      page.getByText('Cet avoir appartient à une autre facture.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: `${credit.number} · Qualifié — figé`, exact: true }),
    ).toHaveCount(0);
  });
  test('late document responses cannot replace the evidence tab', async ({ page }) => {
    const { supplier } = await fixture(page);
    await login(page, credentials());
    await page.goto(`/billing/suppliers/${supplier.id}`);
    await expect(page.getByText('5 résultat(s) · page 1', { exact: true })).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${base}/${supplier.id}/documents?**`, async (route) => {
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    });
    const request = page.waitForRequest((r) => r.url().includes(`${supplier.id}/documents?`));
    await page.getByRole('button', { name: 'Appliquer', exact: true }).click();
    await request;
    await page.getByRole('tab', { name: 'Pièces justificatives', exact: true }).click();
    await expect(page.getByText('3 résultat(s) · page 1', { exact: true })).toBeVisible();
    const response = page.waitForResponse((r) => r.url().includes(`${supplier.id}/documents?`));
    release();
    await response;
    await expect(
      page.getByRole('tab', { name: 'Pièces justificatives', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('3 résultat(s) · page 1', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Télécharger avoir-dossier.pdf', exact: true }),
    ).toBeVisible();
  });
  test('a failed summary is not presented as current and can be retried', async ({ page }) => {
    const { supplier } = await fixture(page);
    await login(page, credentials());
    await page.goto(`/billing/suppliers/${supplier.id}`);
    await expect(
      page.getByRole('region', { name: 'Synthèse documentaire', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actualiser', exact: true })).toBeEnabled();
    await page.route(`**${base}/${supplier.id}`, (route) =>
      route.fulfill({ status: 503, json: { message: 'Synthèse indisponible' } }),
    );
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Synthèse indisponible');
    await expect(
      page.getByRole('region', { name: 'Synthèse documentaire', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText('5 résultat(s) · page 1', { exact: true })).toBeVisible();
    await page.unroute(`**${base}/${supplier.id}`);
    await page.getByRole('button', { name: 'Recharger la synthèse', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Synthèse documentaire', exact: true }),
    ).toContainText('8,20 CAD');
  });
});
