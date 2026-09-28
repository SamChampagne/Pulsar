import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.LEDGER_QUALIFICATION_TENANT;
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
test.describe('Historical journal qualification', () => {
  test.skip(!tenant, 'Isolated historical ledger fixture required');
  test.beforeEach(async ({ page }) => {
    // Filter through the real list query, independently of how many historical fixtures exist.
    await page.route('**/api/v1/billing/ledger-qualification?*', async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.get('search')) url.searchParams.set('search', 'UI ·');
      await route.continue({ url: url.toString() });
    });
  });
  test('recorded asset periods qualify as one group without resuming its plan', async ({
    page,
  }, info) => {
    await login(page, credentials());
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · dotation enfant immobilisation/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    await d
      .getByRole('button', { name: 'Revoir toutes les dotations de l’immobilisation' })
      .click();
    const source = d.getByRole('region', { name: 'Rapprochement de l’immobilisation' });
    await expect(source).toContainText('HIST-PRESSE-01');
    await expect(source).toContainText('200,00');
    await expect(source).toContainText('1 mois sans dotation');
    await expect(d.getByLabel('Devise attestée')).toHaveValue('');
    await source.getByRole('link', { name: 'Ouvrir l’immobilisation' }).click();
    const asset = page.getByRole('region', { name: 'Dossier immobilisation' });
    await expect(asset).toContainText('HIST-PRESSE-01');
    await expect(asset).toContainText('Dossier historique non qualifié');
    await expect(asset.getByRole('button', { name: /Comptabiliser/ })).toHaveCount(0);
    await asset.getByRole('link', { name: 'Reprendre les dotations historiques' }).click();
    await expect(source).toContainText('2024-01 → 2024-03');
    await source.locator('summary').click();
    await expect(source).toContainText('5100 · Charge — débit 100,00');
    await expect(source).toContainText('1590 · Cumul — crédit 100,00');
    await expect(d).toContainText('Première dotation — 2024-01');
    await source.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('asset-history-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await source.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('asset-history-mobile.png'), fullPage: true });
    const version = Number((await d.innerText()).match(/version de qualification (\d+)/)![1]);
    await d.locator('input[type=file]').setInputFiles({
      name: 'immobilisation.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nRecorded depreciation Jan 100 USD and March 100 USD\n%%EOF'),
    });
    await d
      .getByLabel('Description du justificatif')
      .fill('Historique des dotations attestées en USD');
    await d.getByRole('button', { name: 'Conserver le justificatif' }).click();
    await d.getByLabel('Devise attestée').selectOption('USD');
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Toutes les dotations enregistrées sont attestées en USD, sans reprise du plan.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    const review = d.getByRole('region', { name: 'Revue de qualification' });
    await expect(review).toContainText('2 dotations, pour un cumul de 200,00 USD');
    await expect(review).toContainText('Aucun plan futur n’est activé');
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText(`version de qualification ${version + 1}`);
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Retrait groupé de test sans toucher aux montants ni aux périodes.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    await expect(review).toContainText('Le retrait exclura toutes ces dotations ensemble');
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText(`version de qualification ${version + 2}`);
    await expect(d).toContainText('Qualification retirée');
  });
  test('asset details and proofs require source read permission', async ({ page }) => {
    await login(page, credentials('reader'));
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · dotations historiques immobilisation/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    await expect(d).toContainText('Le droit de lecture des immobilisations est requis');
    await expect(d.getByRole('region', { name: 'Rapprochement de l’immobilisation' })).toHaveCount(
      0,
    );
    await expect(d.locator('input[type=file]')).toHaveCount(0);
  });
  test('accepted carrier invoice distinguishes expected lines from payable on desktop and mobile', async ({
    page,
  }, info) => {
    await login(page, credentials());
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · facture transporteur ajustée/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    const source = d.getByRole('region', { name: 'Rapprochement de la facture' });
    const note = source.getByRole('note', { name: 'Montant transporteur accepté' });
    await expect(source).toContainText('105,00 CAD');
    await expect(source).toContainText('15,00 CAD');
    await expect(source).toContainText('Payable accepté');
    await expect(source).toContainText('Acceptation historique');
    await expect(source).not.toContainText('Avoirs émis vérifiés');
    const initialVersion = Number(
      (await d.innerText()).match(/version de qualification (\d+)/)![1],
    );
    await expect(note).toContainText('TR-2024-0187');
    await expect(note).toContainText('100,00 CAD');
    await expect(note).toContainText('120,00 CAD');
    await expect(note).toContainText('115,00 CAD');
    await expect(note).toContainText('5,00 CAD');
    await note.locator('summary').click();
    await expect(note).toContainText('Net des écarts de lignes : 20,00 CAD');
    await source.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('accepted-carrier-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('accepted-carrier-mobile.png'), fullPage: true });
    await expect(d.getByLabel('Devise de la facture source')).toHaveAttribute('readonly', '');
    await d.locator('input[type=file]').setInputFiles({
      name: 'acceptation.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nAccepted 120 CAD; captured tax 15\n%%EOF'),
    });
    await d.getByLabel('Description du justificatif').fill('Facture ajustée et accord historique');
    await d.getByRole('button', { name: 'Conserver le justificatif' }).click();
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Qualification du montant accepté avec taxes conservées, sans recalcul.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    const review = d.getByRole('region', { name: 'Revue de qualification' });
    await expect(review).toContainText('payable accepté de 120,00 CAD');
    await expect(review).toContainText('ne produit aucune écriture complémentaire');
    await expect(review).not.toContainText('Un nouvel avoir');
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText(`version de qualification ${initialVersion + 1}`);
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Retrait de test sans modifier le payable accepté.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText(`version de qualification ${initialVersion + 2}`);
    await expect(note).toContainText('120,00 CAD');
  });
  test('partial payment separates declared, posted and remainder through proof, review and withdrawal', async ({
    page,
  }, info) => {
    await login(page, credentials());
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · paiement avec reste non affecté/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    const source = d.getByRole('region', { name: 'Rapprochement du paiement' });
    await expect(source).toContainText('15,01 CAD');
    await expect(source).toContainText('12,34 CAD');
    await expect(source).toContainText('2,67 CAD');
    await expect(source.getByRole('note')).toContainText('rapprochement bancaire reste bloqué');
    await expect(d.getByLabel('Devise du paiement source')).toHaveAttribute('readonly', '');
    await source.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('partial-payment-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await source.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('partial-payment-mobile.png'), fullPage: true });
    await d.locator('input[type=file]').setInputFiles({
      name: 'affectation.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nAllocated 12.34 of declared 15.01 CAD\n%%EOF'),
    });
    await d.getByLabel('Description du justificatif').fill('Preuve de la portion affectée en CAD');
    await d.getByRole('button', { name: 'Conserver le justificatif' }).click();
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Qualifier la portion comptabilisée sans compléter le reste déclaré.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    const review = d.getByRole('region', { name: 'Revue de qualification' });
    await expect(review).toContainText('Seuls 12,34 CAD');
    await expect(review).toContainText('2,67 CAD ne sera ni comptabilisé ni affecté');
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText('version de qualification 1');
    await expect(source.getByRole('note')).toContainText('2,67 CAD');
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Retrait documenté de la portion qualifiée, sans toucher au reste.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText('version de qualification 2');
  });
  test('invoice and credit group is explained, qualified and withdrawn on desktop and mobile', async ({
    page,
  }, info) => {
    await login(page, credentials());
    await page.goto('/billing/ledger-qualification');
    await expect(page.locator('[data-tour="ledger-qualification"]')).toContainText(
      'factures avec leurs avoirs',
    );
    await page.getByRole('button', { name: /UI · reprise facture historique/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    const source = d.getByRole('region', { name: 'Rapprochement de la facture' });
    await expect(source).toContainText('100,00 CAD');
    await expect(source).toContainText('15,00 CAD');
    await expect(source).toContainText('2 écriture(s)');
    await expect(d.getByLabel('Devise de la facture source')).toHaveValue('CAD');
    await expect(d.getByLabel('Devise de la facture source')).toHaveAttribute('readonly', '');
    await source.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('invoice-source-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await source.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('invoice-source-mobile.png'), fullPage: true });
    await d.locator('input[type=file]').setInputFiles({
      name: 'facture.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nInvoice and credit CAD\n%%EOF'),
    });
    await d
      .getByLabel('Description du justificatif')
      .fill('Facture et avoir originaux exprimés en CAD');
    await d.getByRole('button', { name: 'Conserver le justificatif' }).click();
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Reprise groupée des écritures de la facture et de son avoir.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    await expect(d.getByRole('region', { name: 'Revue de qualification' })).toContainText(
      '2 écriture(s)',
    );
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText('version de qualification 1');
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Retrait de la qualification groupée du dossier de test.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText('version de qualification 2');
  });
  test('known-currency credit explains withdrawal lock and missing invoice rights hide the dossier', async ({
    page,
  }) => {
    await login(page, credentials());
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · facture avec avoir connu/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    await expect(d).toContainText('Retrait impossible');
    await expect(d.getByRole('button', { name: 'Préparer la revue' })).toHaveCount(0);
    await page.context().clearCookies();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await login(page, credentials('reader'));
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · facture avec avoir connu/ }).click();
    await expect(d).toContainText('Le droit de lecture de la facture source est requis');
    await expect(d.getByRole('region', { name: 'Rapprochement de la facture' })).toHaveCount(0);
  });
  test('source overview stays readable on desktop and narrow mobile', async ({ page }, info) => {
    await login(page, credentials());
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · reprise paiement historique/ }).click();
    const source = page.getByRole('region', { name: 'Rapprochement du paiement' });
    await source.scrollIntoViewIfNeeded();
    await expect(source).toContainText('Affectations vérifiées');
    await page.screenshot({ path: info.outputPath('payment-source-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await source.scrollIntoViewIfNeeded();
    await expect(
      source.getByRole('link', { name: 'Ouvrir le registre des paiements' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('payment-source-mobile.png'), fullPage: true });
  });
  test('reader can inspect history without upload or mutation controls, including mobile', async ({
    page,
  }, info) => {
    await login(page, credentials('reader'));
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · qualification historique/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    await expect(d).toContainText('Lecture seule');
    await expect(d.locator('input[type=file]')).toHaveCount(0);
    await expect(d.getByRole('button', { name: 'Préparer la revue' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('qualification-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('qualification-mobile.png'), fullPage: true });
  });
  test('evidence, explicit review, exact confirmation replay after response loss and withdrawal', async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await login(page, credentials());
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · qualification historique/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    await page.route('**/api/v1/billing/ledger-qualification/*/evidence', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const r = await route.fetch();
      expect(r.ok()).toBeTruthy();
      return route.fulfill({ status: 503, json: { message: 'Pièce conservée, réponse perdue' } });
    });
    await d.locator('input[type=file]').setInputFiles({
      name: 'devise.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nUI historical proof\n%%EOF'),
    });
    await d
      .getByLabel('Description du justificatif')
      .fill('Pièce originale — montants exprimés en USD');
    await d.getByRole('button', { name: 'Conserver le justificatif' }).click();
    await expect(d.getByRole('alert')).toContainText('réponse perdue');
    await d.getByRole('button', { name: 'Vérifier l’enregistrement' }).click();
    await expect(d.getByText('Pièce déjà enregistrée : aucune copie ajoutée.')).toBeVisible();
    await page.unroute('**/api/v1/billing/ledger-qualification/*/evidence');
    await d.getByLabel('Devise attestée').selectOption('USD');
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Revue manuelle de la devise du justificatif original.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    await expect(d.getByRole('region', { name: 'Revue de qualification' })).toContainText(
      'Exclue : devise inconnue → USD',
    );
    await page.screenshot({
      path: info.outputPath('qualification-review-desktop.png'),
      fullPage: true,
    });
    let attempts = 0,
      original = '';
    await page.route('**/api/v1/billing/ledger-qualification/*/confirm', async (route) => {
      attempts++;
      if (attempts === 1) {
        original = route.request().postData()!;
        const r = await route.fetch();
        expect(r.ok()).toBeTruthy();
        return route.fulfill({
          status: 503,
          json: { message: 'Décision conservée, réponse perdue' },
        });
      }
      expect(route.request().postData()).toBe(original);
      if (attempts === 2)
        return route.fulfill({ status: 403, json: { message: 'Refus intermédiaire' } });
      return route.fulfill({ response: await route.fetch() });
    });
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText('réponse perdue');
    await page.reload();
    await page.getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Refus intermédiaire');
    await page.getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Reprendre la même demande', exact: true }),
    ).toHaveCount(0);
    await expect(d).toContainText('version de qualification 1');
    await expect(d).toContainText('Retirer la qualification actuelle');
    await page.unroute('**/api/v1/billing/ledger-qualification/*/confirm');
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Retrait de la qualification du dossier de test.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText('version de qualification 2');
    await expect(d).toContainText('Qualification retirée');
    await expect(d).toContainText('Qualification USD');
  });
  test('source workflow and separate permission remain explicit', async ({ page }) => {
    await login(page, credentials('writer'));
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · reprise paiement historique/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    await expect(d).toContainText('Le droit de lecture des paiements est requis');
    await expect(d.locator('input[type=file]')).toHaveCount(0);
  });
  test('payment source review, fixed currency, qualification and withdrawal on desktop and mobile', async ({
    page,
  }, info) => {
    await login(page, credentials());
    await page.goto('/billing/ledger-qualification');
    await page.getByRole('button', { name: /UI · reprise paiement historique/ }).click();
    const d = page.getByRole('region', { name: 'Dossier de qualification' });
    await expect(d.getByRole('region', { name: 'Rapprochement du paiement' })).toContainText(
      '12,34 CAD',
    );
    await expect(d.getByLabel('Devise du paiement source')).toHaveValue('CAD');
    await expect(d.getByLabel('Devise du paiement source')).toHaveAttribute('readonly', '');
    await d.locator('input[type=file]').setInputFiles({
      name: 'paiement.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nSource payment CAD\n%%EOF'),
    });
    await d
      .getByLabel('Description du justificatif')
      .fill('Avis de paiement CAD, rapprochement du dossier source');
    await d.getByRole('button', { name: 'Conserver le justificatif' }).click();
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Le paiement et les affectations correspondent à cet avis en CAD.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    await expect(d.getByRole('region', { name: 'Revue de qualification' })).toContainText(
      '1 écriture(s)',
    );
    await page.screenshot({
      path: info.outputPath('payment-qualification-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('payment-qualification-mobile.png'),
      fullPage: true,
    });
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText('version de qualification 1');
    await d.getByLabel('Preuve de la décision').selectOption({ index: 1 });
    await d
      .getByLabel('Motif documenté (10 caractères minimum)')
      .fill('Retrait documenté de cette qualification de test.');
    await d.getByRole('button', { name: 'Préparer la revue' }).click();
    await d.getByRole('button', { name: 'Confirmer après revue' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmer la décision', exact: true })
      .click();
    await expect(d).toContainText('version de qualification 2');
    await expect(d).toContainText('Qualification retirée');
  });
});
