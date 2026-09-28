import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.FINANCE_PLANNING_TENANT;
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
test.describe('Accounting target and qualified budgets', () => {
  test.skip(!tenant, 'Isolated finance-planning fixture required');
  test('reader sees limitations, profile, budget history and no mutation controls', async ({
    page,
  }, info) => {
    await login(page, credentials('reader'));
    await page.goto('/billing/accounting-profile');
    await expect(page.getByRole('region', { name: 'Limites du profil' })).toContainText(
      'Cible de préparation',
    );
    await expect(page.getByRole('button', { name: 'Enregistrer la cible' })).toHaveCount(0);
    await expect(page.getByLabel('Rôle comptable cible')).toBeDisabled();
    await page.getByRole('link', { name: 'Budgets', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Nouveau budget' })).toHaveCount(0);
    const old = page.getByRole('row').filter({ hasText: 'Historical' });
    await old.getByRole('button', { name: 'Consulter' }).click();
    await expect(page.getByRole('region', { name: 'Détail du budget' })).toContainText(
      'Historique non qualifié',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('budgets-mobile.png'), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
  test('budget preserves exact request across lost response, denial and reload, then exposes exact actuals', async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await login(page, credentials());
    await page.goto('/billing/budgets');
    await page.getByRole('button', { name: 'Nouveau budget', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouveau budget', exact: true });
    const name = 'Budget UI ' + Date.now();
    await dialog.getByLabel('Nom du budget').fill(name);
    await dialog.getByLabel('Exercice', { exact: true }).fill('2026');
    await dialog.getByLabel('Devise du budget').selectOption('CAD');
    await dialog.getByLabel('Début de période').fill('2026-01-01');
    await dialog.getByLabel('Fin de période incluse').fill('2026-12-31');
    await dialog.getByRole('button', { name: /^Compte · ligne 1 :/ }).click();
    await page
      .getByRole('dialog', { name: 'Compte · ligne 1', exact: true })
      .getByRole('option', { name: /^4000/ })
      .click();
    await dialog.getByLabel('Montant · ligne 1').fill('0.50');
    let attempts = 0,
      original = '';
    await page.route('**/api/v1/billing/budgets', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts++;
      if (attempts === 1) {
        original = route.request().postData()!;
        const r = await route.fetch();
        expect(r.ok()).toBeTruthy();
        return route.fulfill({ status: 503, json: { message: 'Réponse perdue' } });
      }
      expect(route.request().postData()).toBe(original);
      if (attempts === 2)
        return route.fulfill({ status: 403, json: { message: 'Refus intermédiaire' } });
      return route.fulfill({ response: await route.fetch() });
    });
    await dialog.getByRole('button', { name: 'Enregistrer le budget' }).click();
    await page
      .getByRole('dialog', { name: 'Confirmer cette action' })
      .getByRole('button', { name: 'Confirmer', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText('Réponse perdue');
    await page.reload();
    await expect(dialog.getByLabel('Nom du budget')).toHaveValue(name);
    await expect(dialog.getByLabel('Nom du budget')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Reprendre la demande' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Refus intermédiaire');
    await dialog.getByRole('button', { name: 'Reprendre la demande' }).click();
    await expect(dialog).toHaveCount(0);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Consulter' }).click();
    const detail = page.getByRole('region', { name: 'Détail du budget' });
    await expect(detail.getByRole('cell', { name: '0,30', exact: true })).toBeVisible();
    await expect(detail).toContainText('Autres devises exclues');
    await page.screenshot({ path: info.outputPath('budget-desktop.png'), fullPage: true });
    await row.getByRole('button', { name: 'Modifier' }).click();
    const edit = page.getByRole('dialog', { name: 'Réviser le budget' });
    await expect(edit.getByLabel('Devise du budget')).toHaveCount(0);
    await edit.getByRole('checkbox').uncheck();
    await edit.getByRole('button', { name: 'Enregistrer le budget' }).click();
    await page
      .getByRole('dialog', { name: 'Confirmer cette action' })
      .getByRole('button', { name: 'Confirmer', exact: true })
      .click();
    await expect(edit).toHaveCount(0);
    await expect(row).toContainText('Archivé');
  });
  test('explicit external target resumes after committed response loss without enabling sync', async ({
    page,
  }, info) => {
    await login(page, credentials());
    await page.goto('/billing/accounting-profile');
    await expect(page.getByText('Cible actuelle', { exact: false })).toBeVisible();
    await page.getByLabel('Rôle comptable cible').selectOption('EXTERNAL');
    await page.getByLabel('Logiciel de référence').fill('Comptabilité externe de test');
    await page.getByLabel('Devise fonctionnelle cible').selectOption('USD');
    await page
      .getByLabel('Motif du choix ou du changement')
      .fill('Choix de préparation, pas de synchronisation');
    let first = true,
      body = '';
    await page.route('**/api/v1/billing/accounting-profile', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      if (first) {
        first = false;
        body = route.request().postData()!;
        const r = await route.fetch();
        expect(r.ok()).toBeTruthy();
        return route.fulfill({ status: 503, json: { message: 'Profil conservé, réponse perdue' } });
      }
      expect(route.request().postData()).toBe(body);
      return route.fulfill({ response: await route.fetch() });
    });
    await page.getByRole('button', { name: 'Enregistrer la cible' }).click();
    await page
      .getByRole('dialog', { name: 'Confirmer cette action' })
      .getByRole('button', { name: 'Confirmer', exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText('réponse perdue');
    await page.reload();
    await expect(page.getByLabel('Logiciel de référence')).toBeDisabled();
    await page.getByRole('button', { name: 'Reprendre la demande' }).click();
    await expect(page.getByRole('button', { name: 'Enregistrer la cible' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Limites du profil' })).toContainText(
      'ne le connecte pas',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('profile-mobile.png'), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
