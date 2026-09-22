import { expect, test } from './fixtures';
import { login, EXPERIENCED_PREFERENCES } from './helpers';

for (const width of [1280, 390]) {
  test(`workspace stays fixed and protects edits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page);
    await page.goto('/crm/pipeline');
    await expect(page.getByLabel('Pipeline actif')).toBeEnabled();
    if (width === 1280)
      await expect(page.getByRole('button', { name: 'Ouvrir le menu' })).not.toBeVisible();
    const board = page.getByLabel('Tableau des opportunités');
    const before = await board.boundingBox();
    const shell = page.getByTestId('workspace-shell');
    const shellBefore = await shell.boundingBox();
    const trigger = page.getByRole('button', { name: 'Configurer les colonnes', exact: true });
    await trigger.click();
    const panel = page.getByRole('dialog', { name: 'Configurer les colonnes', exact: true });
    await expect(panel).toBeVisible();
    await expect.poll(() => shell.boundingBox()).toEqual(shellBefore);
    expect(await board.boundingBox()).toEqual(before);
    await expect(page.locator('#workspace-content')).toHaveCSS('overflow', 'hidden');
    await expect(panel.getByRole('button', { name: 'Fermer', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(panel.getByRole('button', { name: 'Annuler', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(panel.getByRole('button', { name: 'Fermer', exact: true })).toBeFocused();
    const name = panel.getByLabel('Nom du pipeline', { exact: true });
    const originalName = await name.inputValue();
    await name.fill(originalName + ' brouillon non enregistré');
    await page.keyboard.press('Escape');
    const discard = page.getByRole('dialog', { name: 'Abandonner les modifications ?' });
    await expect(discard).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(discard).not.toBeVisible();
    await expect(panel).toBeVisible();
    await expect(name).toHaveValue(originalName + ' brouillon non enregistré');
    await expect(page.locator('#workspace-content')).toHaveCSS('overflow', 'hidden');
    await panel.getByRole('button', { name: 'Fermer', exact: true }).click();
    await discard.getByRole('button', { name: 'Abandonner', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.locator('#workspace-content')).toHaveCSS('overflow', 'auto');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - innerHeight),
    ).toBeLessThanOrEqual(1);
    await trigger.click();
    await expect(name).toHaveValue(originalName);
    await page.screenshot({
      path: `playwright-artifacts/workspace-panel-${width}.png`,
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
}

test('app switcher keeps the selected pipeline URL and the desktop remains an icon launcher', async ({
  page,
}) => {
  await login(page);
  await page.goto('/crm/pipeline');
  await expect(page.getByLabel('Pipeline actif')).toBeEnabled();
  const pipelineId = await page.getByLabel('Pipeline actif').inputValue();
  await page.goto('/crm/pipeline?pipelineId=' + encodeURIComponent(pipelineId));
  const pipelineUrl = page.url();
  await expect(page.getByLabel('Pipeline actif')).toHaveValue(pipelineId);
  await page.getByRole('button', { name: 'Changer d’application' }).click();
  let switcher = page.getByRole('dialog', { name: 'Changer d’application' });
  await switcher.getByLabel('Filtrer les applications').fill('Finance');
  await expect(switcher.getByLabel('Applications accessibles').getByRole('link')).toHaveCount(1);
  await switcher.getByRole('link', { name: 'Finance', exact: true }).click();
  await expect(page).toHaveURL(/\/finance$/);
  await page.getByRole('button', { name: 'Changer d’application' }).click();
  switcher = page.getByRole('dialog', { name: 'Changer d’application' });
  await switcher.getByRole('link', { name: 'CRM', exact: true }).click();
  await expect(page).toHaveURL(pipelineUrl);
  await expect(page.getByLabel('Pipeline actif')).toHaveValue(pipelineId);
  await page.getByRole('link', { name: 'Retour au bureau Pulsar' }).click();
  await expect(page.getByRole('heading', { name: 'Votre bureau' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'CRM', exact: true })).toBeVisible();
  await page.getByLabel('Rechercher une app', { exact: true }).fill('CRM');
  await expect(page.getByRole('button', { name: 'Finance', exact: true })).not.toBeVisible();
  await page.getByLabel('Rechercher une app', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'Finance', exact: true })).toBeVisible();
  await page.screenshot({ path: 'playwright-artifacts/workspace-desktop.png' });
});

test('mobile navigation opens and closes with focus return and no horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto('/crm/pipeline');
  const menu = page.getByRole('button', { name: 'Ouvrir le menu' });
  await menu.click();
  const dialog = page.getByRole('dialog', { name: 'CRM', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(menu).toBeFocused();
  await menu.click();
  await dialog.getByRole('link', { name: 'Contacts', exact: true }).click();
  await expect(page).toHaveURL(/\/crm\/contacts$/);
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Retour au bureau Pulsar' }).click();
  const search = page.getByLabel('Rechercher une app sur le bureau');
  await search.fill('CRM');
  await expect(page.getByRole('button', { name: 'CRM', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'playwright-artifacts/workspace-mobile.png' });
});

test('reduced motion keeps dialogs usable and finance errors do not look like a healthy empty state', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.getByRole('button', { name: 'Changer d’application' }).click();
  const dialog = page.getByRole('dialog', { name: 'Changer d’application' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('animation-duration', '1e-05s');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.route('**/api/v1/billing/invoices', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Finance temporairement indisponible' }),
    }),
  );
  await page.goto('/finance');
  await expect(page.getByRole('alert')).toContainText('Finance temporairement indisponible');
  await expect(page.getByLabel('Situation de la facturation')).not.toBeVisible();
  await expect(
    page.getByText('Aucun brouillon, litige ou écart à traiter dans les factures chargées.'),
  ).not.toBeVisible();
});

test('dark theme preserves desktop labels and folder keyboard behavior without saving preferences', async ({
  page,
}) => {
  await login(page);
  await page.route('**/api/v1/me/preferences', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, ...EXPERIENCED_PREFERENCES, appearance: { theme: 'dark' } },
    });
  });
  await page.goto('/apps');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Votre bureau' })).toBeVisible();
  const folder = page.getByRole('button', { name: 'Ouvrir le dossier Framework', exact: true });
  await folder.click();
  const dialog = page.getByRole('dialog', { name: 'Framework', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#workspace-content')).toHaveCSS('overflow', 'hidden');
  await expect(dialog.getByRole('button').first()).toBeFocused();
  await page.screenshot({
    path: 'playwright-artifacts/workspace-folder-dark.png',
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(folder).toBeFocused();
  await expect(page.locator('#workspace-content')).toHaveCSS('overflow', 'auto');
});
