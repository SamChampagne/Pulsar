import { test, expect } from './fixtures';
import { login } from './helpers';

// Prepared by api/test/module-autonomy.e2e-spec.ts in an isolated database.
// Never disable modules on the shared demo tenant to simulate a standalone customer.
const prefix = process.env.PULSAR_AUTONOMY_TENANT_PREFIX;
test.skip(
  !prefix,
  'Run the isolated HTTP autonomy fixtures and supply PULSAR_AUTONOMY_TENANT_PREFIX.',
);
function credentials(module: string, role = 'manager') {
  const tenant = `${prefix}-${module}`;
  return { tenant, email: `${role}@${tenant}.test`, password: 'Test1234!' };
}

test('Services alone creates a customer inside the project form without losing work', async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/')) calls.push(r.url());
  });
  await login(page, credentials('services'));
  await page.goto('/services');
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  const title = `Autonomie ${Date.now()}`;
  await page.getByLabel('Titre du projet').fill(title);
  await page.getByRole('button', { name: /^Client :/ }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Ajouter sans quitter ce formulaire' })
    .click();
  const editor = page.getByRole('dialog').last();
  await editor.getByLabel('Code').fill(`UI-${Date.now()}`);
  await editor.getByLabel('Nom').fill(title + ' Client');
  await editor.getByLabel('Téléphone').fill('5145550101');
  await page.screenshot({ path: testInfo.outputPath('inline-customer.png'), fullPage: true });
  await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByLabel('Titre du projet')).toHaveValue(title);
  await expect(page.getByRole('button', { name: /^Client :/ })).toContainText(title + ' Client');
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Enregistrer', exact: true })
    .click();
  await expect(page).toHaveURL(/\/services\/projects\//);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(calls.filter((url) => /\/api\/v1\/(catalog|transportation)\//.test(url))).toEqual([]);
  expect(failures).toEqual([]);
});

test('Clients alone separates addresses, persists column choices and displays the user time zone', async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await login(page, credentials('clients'));
  await page.goto('/clients');
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Fuseau utilisateur/ }).click();
  await page.getByLabel('Fuseau d’affichage').fill('America/Vancouver');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Fuseau utilisateur : America/Vancouver', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const editor = page.getByRole('dialog').last();
  const name = `Client adresses ${Date.now()}`;
  await editor.getByLabel('Code').fill(`ADDR-${Date.now()}`);
  await editor.getByLabel('Nom', { exact: false }).first().fill(name);
  const billing = editor.getByRole('group', { name: 'Adresse de facturation', exact: true });
  await billing.getByRole('checkbox').check();
  await billing.getByLabel('Rue et numéro').fill('12 Rue du Port');
  await billing.getByLabel('Ville', { exact: true }).fill('Montréal');
  await billing.getByLabel('Code postal').fill('H2Y 1C6');
  await editor.getByRole('button', { name: 'Copier la facturation vers la livraison' }).click();
  const shipping = editor.getByRole('group', {
    name: 'Adresse de livraison par défaut',
    exact: true,
  });
  await shipping.getByLabel('Ville', { exact: true }).fill('Boston');
  await shipping.getByLabel('Pays (code ISO)').fill('US');
  await shipping.getByLabel('Code postal').fill('02108');
  expect(
    await editor
      .locator('input')
      .evaluateAll((inputs) =>
        inputs
          .filter((i) => !(i as HTMLInputElement).validity.valid)
          .map((i) => ({
            label: (i as HTMLInputElement).labels?.[0]?.textContent,
            value: (i as HTMLInputElement).value,
            error: (i as HTMLInputElement).validationMessage,
          })),
      ),
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('address-editor.png'), fullPage: true });
  await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  expect(failures).toEqual([]);
  await expect(editor).not.toBeVisible();
  await page.getByRole('textbox', { name: 'Rechercher dans les données' }).fill(name);
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Montréal');
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Boston');
  await page.getByText('Colonnes et largeur', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Courriel', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Redimensionner Nom', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('columnheader', { name: /^Courriel/ })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Fuseau utilisateur : America/Vancouver', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /^Courriel/ })).toHaveCount(0);
  await page.getByText('Colonnes et largeur', { exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Largeur Nom', exact: true })).toHaveValue('240');
  await page.screenshot({ path: testInfo.outputPath('clients-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: /^Fuseau utilisateur/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('clients-mobile.png'), fullPage: true });
  expect(failures).toEqual([]);
});

test('Clients presents its specific tutorial only on the first user entry', async ({
  page,
}, testInfo) => {
  await login(page, credentials('clients', 'reader'));
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto('/clients');
  const tour = page.getByRole('dialog', {
    name: 'Une fiche partagée, pas un module imposé',
    exact: true,
  });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choisir le bon registre' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('clients-tutorial.png'), fullPage: true });
  await page.getByRole('button', { name: 'Passer le tutoriel', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Passer le tutoriel', exact: true })).toHaveCount(
    0,
  );
});

test('Fleet alone opens its overview and register, then creates and edits its shared identities', async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  const denied: string[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && [403, 404, 500].includes(r.status()))
      denied.push(`${r.status()} ${r.url()}`);
  });
  await login(page, credentials('fleet'));
  for (const path of ['/assets', '/fleet/register', '/fleet/maintenance']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByText('Impossible de charger la flotte', { exact: true })).toHaveCount(0);
  }
  await page.goto('/fleet/data');
  await page.getByRole('button', { name: 'Transporteurs', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const name = `Transporteur UI ${Date.now()}`;
  let dialog = page.getByRole('dialog').last();
  await dialog.getByLabel('Code').fill(`UI-${Date.now()}`);
  await dialog.getByLabel('Nom', { exact: false }).first().fill(name);
  await dialog.getByLabel('SCAC').fill('TEST');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rechercher dans les données' }).fill(name);
  await page.getByRole('button', { name: `Modifier ${name}`, exact: true }).click();
  dialog = page.getByRole('dialog').last();
  await dialog.getByLabel('Statut').selectOption('INACTIVE');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Inactif');
  await page.screenshot({ path: testInfo.outputPath('fleet-data.png'), fullPage: true });
  expect(denied).toEqual([]);
  expect(failures).toEqual([]);
});

test('A read-only Services user can see shared data but cannot edit it', async ({
  page,
}, testInfo) => {
  await login(page, credentials('services', 'reader'));
  await page.goto('/services/data');
  await expect(page.getByRole('heading', { name: 'Données', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Modifier / })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('data-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
