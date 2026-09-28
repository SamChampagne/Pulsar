import { test, expect, type Page } from './fixtures';
import { login } from './helpers';
const tenant = process.env.PARTY_WORKSPACE_TENANT;
const partnerId = process.env.PARTY_WORKSPACE_PARTNER;
test.skip(
  !tenant || !partnerId,
  'Create party-workspace HTTP fixtures on the isolated database first.',
);
test.use({ reducedMotion: 'reduce' });
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
async function open(page: Page, role = 'manager') {
  const session = await page.request.post('/api/v1/auth/login', { data: credentials(role) });
  expect(session.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const response = await page.request.get(`/api/v1/clients/data/partners/${partnerId}`, {
    headers,
  });
  expect(response.ok()).toBeTruthy();
  const partner = await response.json();
  await login(page, credentials(role));
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Services et SAV', exact: true }).click();
  await page.getByLabel('Rechercher dans les données').fill(partner.code);
  await page.getByRole('button', { name: `Dossier 360° de ${partner.name}`, exact: true }).click();
  return page.getByRole('dialog', { name: `Dossier 360° · ${partner.name}`, exact: true });
}
test('Client workspace: server pages, persistent search focus, source link and mobile', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dialog = await open(page);
  await expect(dialog.getByRole('status')).toContainText('13 résultats');
  await dialog.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(dialog.getByText('Page 2 / 2', { exact: true })).toBeVisible();
  const search = dialog.getByRole('searchbox');
  await search.fill('Installation');
  await expect(dialog.getByRole('status')).toContainText('1 résultat');
  await expect(search).toBeFocused();
  await expect(dialog.getByRole('link')).toHaveCount(1);
  await expect(dialog.getByText('Installation réseau', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: /^Demandes SAV/ }).click();
  await expect(dialog.getByRole('link')).toHaveAttribute('href', /\/support\?caseId=/);
  await page.screenshot({ path: testInfo.outputPath('client-workspace-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByLabel('Type de dossier', { exact: true }).selectOption('service-project');
  await expect(dialog.getByRole('status')).toContainText('13 résultats');
  await dialog.getByRole('searchbox').fill('Installation');
  await expect(dialog.getByRole('status')).toContainText('1 résultat');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await dialog
    .getByRole('heading', { name: 'Une fiche, les dossiers liés' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('client-workspace-mobile.png') });
  const source = await dialog.getByRole('link').getAttribute('href');
  await dialog.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`${source}$`));
  await expect(page.getByRole('heading', { name: /Installation réseau/ }).first()).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('Read error removes old dossiers; retry succeeds without writes', async ({ page }) => {
  const dialog = await open(page);
  await expect(dialog.getByRole('status')).toContainText('13 résultats');
  const writes: string[] = [];
  page.on('request', (r) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.method()) && !r.url().includes('/auth/'))
      writes.push(r.url());
  });
  const route = `**/api/v1/clients/data/partners/${partnerId}/workspace*`;
  await page.route(route, (r) =>
    r.fulfill({ status: 503, json: { message: 'Lecture temporairement indisponible' } }),
  );
  await dialog.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(
    dialog.getByText('Lecture temporairement indisponible', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveCount(0);
  await expect(dialog.getByRole('navigation', { name: 'Types de dossiers' })).toHaveCount(0);
  await page.unroute(route);
  await dialog.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('13 résultats');
  expect(writes).toEqual([]);
});
test('A client reader sees neither financial counts nor documents', async ({ page }) => {
  const dialog = await open(page, 'reader');
  await expect(dialog.getByText('Aucune section accessible', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Factures clients/ })).toHaveCount(0);
});
