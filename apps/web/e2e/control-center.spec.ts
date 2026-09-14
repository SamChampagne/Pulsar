import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('navigation palette supports repeated module labels and keyboard dismissal', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Navigation rapide' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Rechercher une destination').fill('Configuration');
  expect(await dialog.getByRole('button').count()).toBeGreaterThan(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('saved work view, contextual dossier and mobile containment', async ({ page }) => {
  await login(page);
  await page.goto('/workflows');
  await page.getByRole('combobox').nth(0).selectOption('TRANSPORT_ORDER');
  await page.getByLabel('Nom de la vue').fill('Transport QA');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Transport QA', exact: true }).click();
  await expect(page.getByRole('combobox').nth(0)).toHaveValue('TRANSPORT_ORDER');
  const open = page.getByRole('button', { name: 'Voir le parcours', exact: true }).first();
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Dossier intermodule' });
  await expect(dialog.getByRole('heading', { name: 'Ordres de transport' })).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Événements, tâches et décisions' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: 'Dossiers connectés', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test('platform cockpit, tenant diagnostic and available module catalog', async ({ page }) => {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill('platform@pulsar.dev');
  await page.getByLabel('Password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/platform/tenants');
  await page.getByRole('link', { name: 'Exploitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Centre d’exploitation' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'API Pulsar', exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: 'Sauvegarde et restauration' })
    .getByRole('button', { name: 'Diagnostic' })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Entreprises', exact: true }).click();
  await page.getByRole('button', { name: 'Acme Manufacturing', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Configuration IA' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'wms', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.getByRole('link', { name: 'Exploitation', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'API Pulsar', exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
});
