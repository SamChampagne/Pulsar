import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('invoice tabs are keyboard navigable and expose their selected panel', async ({ page }) => {
  await login(page);
  await page.goto('/invoices');
  const carrier = page.getByRole('tab', { name: 'Factures transporteurs', exact: true });
  const customer = page.getByRole('tab', { name: 'Relevés clients', exact: true });
  await carrier.focus();
  await page.keyboard.press('ArrowRight');
  await expect(customer).toBeFocused();
  await expect(customer).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Relevés clients' })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(carrier).toBeFocused();
  await expect(carrier).toHaveAttribute('aria-selected', 'true');
});

test('contact drawers retain the list width, close safely and return keyboard focus', async ({
  page,
}) => {
  await login(page);
  await page.goto('/crm/contacts');
  const open = page.locator('main table').getByRole('button').first();
  await expect(open).toBeVisible();
  const name = await open.innerText();
  const table = page.locator('main table');
  const before = (await table.boundingBox())!;
  await open.click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  expect(Math.abs((await table.boundingBox())!.width - before.width)).toBeLessThan(2);
  await expect(dialog.getByRole('button', { name: 'Fermer', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await open.click();
  await expect(dialog).toBeVisible();
  // Chromium may report 390.000002 during the transform animation.
  // Keep the separate document-overflow assertion below.
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390.01);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
});

test('company picker searches by name inside a contact form, Escape only closes the picker', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/v1/crm/companies**', async (route) => {
    const url = new URL(route.request().url());
    const company = { id: 'company-ui-test', name: 'Société recherchée' };
    await route.fulfill({
      json: url.pathname.endsWith('/companies')
        ? { items: [company], total: 1, page: 1, pageSize: 20 }
        : company,
    });
  });
  await page.goto('/crm/contacts');
  await page.getByRole('button', { name: 'Nouveau contact', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nouveau contact', exact: true });
  await form.getByLabel('Nom *', { exact: true }).fill('Brouillon conservé');
  await form.getByRole('button', { name: 'Société : Associer une société' }).click();
  const picker = page.getByRole('dialog', { name: 'Société', exact: true });
  await picker.getByLabel('Rechercher : société').fill('recherchée');
  await picker.getByRole('button', { name: 'Société recherchée', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Société : Société recherchée' })).toBeVisible();
  await form.getByRole('button', { name: 'Société : Société recherchée' }).click();
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Nom *', { exact: true })).toHaveValue('Brouillon conservé');
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
});

test('a closed contact drawer never reopens when a slow response arrives', async ({ page }) => {
  await login(page);
  await page.goto('/crm/contacts');
  const first = page.locator('main table').getByRole('button').first();
  await expect(first).toBeVisible();
  let release: (() => void) | undefined;
  await page.route(/\/api\/v1\/crm\/contacts\/[^/?]+$/, async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      json: { id: 'late', name: 'Réponse tardive', createdAt: '2026-09-14T00:00:00Z' },
    });
  });
  await first.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => !!release).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const response = page.waitForResponse(/\/api\/v1\/crm\/contacts\/[^/?]+$/);
  release!();
  await response;
  await expect(page.getByText('Réponse tardive', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('settings retain edits on failure, confirm cancellation, and retry successfully', async ({
  page,
}) => {
  await login(page);
  let writes = 0;
  await page.route('**/api/v1/modules/crm/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      writes++;
      await route.fulfill(
        writes === 1
          ? { status: 500, json: { message: 'Erreur de sauvegarde simulée' } }
          : { json: { values: route.request().postDataJSON().settings } },
      );
    } else
      await route.fulfill({
        json: {
          descriptors: [
            {
              key: 'prefix',
              label: 'Préfixe de test',
              type: 'string',
              default: 'CRM',
              maxLength: 12,
            },
            { key: 'auto', label: 'Suivi de test', type: 'boolean', default: false },
          ],
          values: { prefix: 'CRM', auto: false },
        },
      });
  });
  await page.goto('/crm/config');
  const input = page.getByLabel('Préfixe de test', { exact: true });
  const save = page
    .getByRole('form', { name: 'Réglages du module' })
    .getByRole('button', { name: 'Enregistrer', exact: true });
  await expect(save).toBeDisabled();
  await input.fill('MODIF');
  await expect(page.getByText('Modifications non enregistrées', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler les modifications' }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'Abandonner les modifications',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(input).toHaveValue('MODIF');
  expect(writes).toBe(0);
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Erreur de sauvegarde simulée');
  await expect(input).toHaveValue('MODIF');
  await save.click();
  await expect(page.getByText('Réglages enregistrés', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  expect(writes).toBe(2);
});

test('desktop reset uses an in-app confirmation and can be cancelled without writing', async ({
  page,
}) => {
  await login(page);
  await page.goto('/personalize');
  let nativeDialogs = 0;
  page.on('dialog', async (dialog) => {
    nativeDialogs++;
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Réinitialiser la disposition', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmer cette action', exact: true });
  await expect(dialog).toContainText('Réinitialiser entièrement la disposition du bureau');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(nativeDialogs).toBe(0);
});

for (const [route, trigger, title] of [
  ['/billing/budgets', '+ Nouveau budget', 'Nouveau budget'],
  ['/billing/subscriptions', '+ Nouvel abonnement', 'Nouvel abonnement'],
  ['/billing/fixed-assets', '+ Nouvelle immobilisation', 'Nouvelle immobilisation'],
  ['/billing/banking', '+ Nouveau compte', 'Nouveau compte bancaire'],
]) {
  test(`billing editor is a bounded accessible dialog: ${route}`, async ({ page }) => {
    await login(page);
    await page.goto(route);
    await page.getByRole('button', { name: trigger, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Fermer', exact: true })).toBeFocused();
    await page.setViewportSize({ width: 390, height: 680 });
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
    expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(680);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

test('operation homepages use a single heading and connectors open without pushing content', async ({
  page,
}) => {
  await login(page);
  for (const route of ['/agents', '/assets', '/integrations', '/wms', '/crm']) {
    await page.goto(route);
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  }
  await page.goto('/integrations');
  const catalogue = page
    .getByRole('heading', { name: 'Ajouter une intégration', exact: true })
    .locator('..')
    .locator('..')
    .locator('..');
  await catalogue.getByRole('button').first().click();
  await expect(page.getByRole('dialog', { name: 'Nouveau connecteur', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
