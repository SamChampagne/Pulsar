import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.ASSET_CURRENCY_TENANT;
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
test.describe('Qualified fixed assets', () => {
  test.skip(!tenant, 'Isolated assets fixture required');
  test('reader can distinguish unknown history without mutation controls on mobile', async ({
    page,
  }, info) => {
    await login(page, credentials('reader'));
    await page.goto('/billing/fixed-assets');
    await expect(
      page.getByRole('button', { name: 'Nouvelle immobilisation', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Ouvrir HISTORICAL', exact: true })
      .filter({ visible: true })
      .click();
    const detail = page.getByRole('region', { name: 'Dossier immobilisation' });
    await expect(detail).toContainText('Dossier historique non qualifié');
    await expect(detail.getByRole('button', { name: 'Retirer du suivi', exact: true })).toHaveCount(
      0,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('assets-mobile.png'), fullPage: true });
  });
  test('draft, exact replay after committed response loss, frozen plan, GL and withdrawal', async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await login(page, credentials());
    await page.goto('/billing/fixed-assets');
    await page.getByRole('button', { name: 'Nouvelle immobilisation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouvelle immobilisation', exact: true });
    const code = 'UI-' + Date.now();
    await dialog.getByLabel('Code immobilisation').fill(code);
    await dialog.getByLabel('Nom immobilisation').fill('Équipement de test UI');
    await dialog.getByLabel('Devise immobilisation').selectOption('USD');
    await dialog.getByLabel('Date acquisition').fill('2024-01-25');
    await dialog.getByLabel('Coût immobilisation').fill('100.00');
    await dialog.getByLabel('Valeur résiduelle').fill('0.00');
    await dialog.getByLabel('Premier mois').fill('2024-01');
    await dialog.getByLabel('Durée en mois').fill('3');
    await dialog.getByRole('button', { name: /^Compte de charge :/ }).click();
    await page
      .getByRole('dialog', { name: 'Compte de charge', exact: true })
      .getByRole('option', { name: /^5100/ })
      .click();
    await dialog.getByRole('button', { name: /^Compte de cumul \(Actif\) :/ }).click();
    await page
      .getByRole('dialog', { name: 'Compte de cumul (Actif)', exact: true })
      .getByRole('option', { name: /^1590/ })
      .click();
    await dialog.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
    await page
      .getByRole('dialog', { name: 'Confirmer cette action' })
      .getByRole('button', { name: 'Confirmer', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const detail = page.getByRole('region', { name: 'Dossier immobilisation' });
    await expect(detail).toContainText('Plan prévisionnel à valider');
    await expect(detail).toContainText('33,34');
    await detail.getByRole('button', { name: 'Figer et activer le plan' }).click();
    await page
      .getByRole('dialog', { name: 'Confirmer cette action' })
      .getByRole('button', { name: 'Confirmer', exact: true })
      .click();
    await expect(detail).toContainText('Plan figé');
    await expect(detail.getByRole('button', { name: 'Modifier le brouillon' })).toHaveCount(0);
    let attempts = 0,
      original = '';
    await page.route('**/api/v1/billing/fixed-assets/*/depreciate', async (route) => {
      attempts++;
      if (attempts === 1) {
        original = route.request().postData()!;
        const r = await route.fetch();
        expect(r.ok()).toBeTruthy();
        return route.fulfill({
          status: 503,
          json: { message: 'Dotation conservée, réponse perdue' },
        });
      }
      expect(route.request().postData()).toBe(original);
      if (attempts === 2)
        return route.fulfill({ status: 403, json: { message: 'Refus intermédiaire' } });
      return route.fulfill({ response: await route.fetch() });
    });
    await detail.getByRole('button', { name: 'Comptabiliser la prochaine dotation' }).click();
    await page
      .getByRole('dialog', { name: 'Confirmer cette action' })
      .getByRole('button', { name: 'Confirmer', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText('réponse perdue');
    await page.reload();
    await page.getByRole('button', { name: 'Reprendre la demande conservée' }).click();
    await expect(page.getByRole('alert')).toContainText('Refus intermédiaire');
    await page.getByRole('button', { name: 'Reprendre la demande conservée' }).click();
    await expect(page.getByRole('button', { name: 'Reprendre la demande conservée' })).toHaveCount(
      0,
    );
    await expect(detail).toContainText('Prochaine période : 2024-02');
    await expect(detail.getByRole('link', { name: 'Voir l’écriture' })).toHaveCount(1);
    await detail.screenshot({ path: info.outputPath('asset-plan-desktop.png') });
    await detail.getByRole('link', { name: 'Voir l’écriture' }).click();
    await expect(page).toHaveURL(/billing\/ledger\?sourceType=depreciation/);
    await expect(page.getByText('Dotation ' + code + ' 2024-01', { exact: true })).toHaveCount(1);
    await expect(
      page.getByText('Écritures comptabilisées · 1 résultat(s)', { exact: true }),
    ).toBeVisible();
    await page.goto('/billing/fixed-assets');
    await page
      .getByRole('button', { name: 'Ouvrir ' + code, exact: true })
      .filter({ visible: true })
      .click();
    await detail.getByRole('button', { name: 'Retirer du suivi', exact: true }).click();
    const retire = page.getByRole('dialog', { name: 'Retirer du suivi', exact: true });
    await retire.getByLabel('Motif du retrait').fill('Fin de test sans cession comptable');
    await retire.getByRole('button', { name: 'Confirmer le retrait' }).click();
    await page
      .getByRole('dialog', { name: 'Confirmer cette action' })
      .getByRole('button', { name: 'Confirmer', exact: true })
      .click();
    await expect(retire).toHaveCount(0);
    await expect(detail).toContainText('Suivi arrêté');
    await expect(detail).toContainText('Fin de test sans cession comptable');
    await expect(
      detail.getByRole('button', { name: 'Comptabiliser la prochaine dotation' }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await detail.screenshot({ path: info.outputPath('asset-detail-mobile.png') });
  });
  test('manager without posting or journal privileges sees contextual limits', async ({ page }) => {
    await login(page, credentials('writer'));
    await page.goto('/billing/fixed-assets');
    await page
      .getByRole('button', { name: 'Ouvrir POST-CAD', exact: true })
      .filter({ visible: true })
      .click();
    const detail = page.getByRole('region', { name: 'Dossier immobilisation' });
    await expect(detail).toContainText('Écriture comptabilisée');
    await expect(detail.getByRole('link', { name: 'Voir l’écriture' })).toHaveCount(0);
    await expect(
      detail.getByRole('button', { name: 'Comptabiliser la prochaine dotation' }),
    ).toHaveCount(0);
  });
});
