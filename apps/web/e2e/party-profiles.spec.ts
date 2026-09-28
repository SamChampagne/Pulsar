import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.PARTY_PROFILES_TENANT;
test.skip(!tenant, 'Create party-profiles HTTP fixtures on the isolated database first.');
test.use({ reducedMotion: 'reduce' });
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
async function fixture(page: any) {
  const response = await page.request.post('/api/v1/auth/login', { data: credentials() });
  expect(response.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await response.json()).accessToken}` };
  const create = async (path: string, data: object) => {
    const r = await page.request.post(`/api/v1${path}`, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const name = `Atelier UI ${Date.now()}`;
  const partner = await create('/clients/data/partners', { code: crypto.randomUUID(), name });
  const customer = await create('/clients/data/customers', {
    code: crypto.randomUUID(),
    name: `Client ${name}`,
  });
  const company = await create('/crm/companies', { name: `CRM ${name}` });
  return { partner, customer, company, headers };
}
async function open(page: any, name: string, role = 'manager') {
  await login(page, credentials(role));
  await page.goto('/clients');
  await page.getByRole('button', { name: 'Services et SAV', exact: true }).click();
  await page.getByLabel('Rechercher dans les données').fill(name);
  await page.getByRole('button', { name: `Fiche entreprise de ${name}`, exact: true }).click();
  return page.getByRole('dialog', { name: `Fiche entreprise · ${name}`, exact: true });
}
test('Company profile: save, lost response inspection, persisted extensions and mobile', async ({
  page,
}, testInfo) => {
  const f = await fixture(page),
    dialog = await open(page, f.partner.name);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await dialog.getByLabel('Raison sociale', { exact: true }).fill('Ateliers du Fleuve Inc.');
  await dialog.getByLabel('Fuseau de l’entreprise', { exact: true }).fill('America/Toronto');
  await dialog
    .getByLabel('Consignes pour les livraisons / accès', { exact: true })
    .fill('Présentez-vous à la porte 4.');
  await dialog.getByRole('button', { name: 'Ajouter une information', exact: true }).click();
  await dialog.getByLabel('Libellé complémentaire 1').fill('Référence contrat');
  await dialog.getByLabel('Valeur complémentaire 1').fill('CF-2026-48');
  const route = `**/api/v1/clients/data/partners/${f.partner.id}/business-profile`;
  let intercepted = false;
  await page.route(route, async (r) => {
    if (r.request().method() !== 'PUT' || intercepted) return r.continue();
    intercepted = true;
    const actual = await r.fetch();
    expect(actual.ok()).toBeTruthy();
    await r.fulfill({ status: 503, json: { message: 'Réponse simulée perdue' } });
  });
  await dialog.getByRole('button', { name: 'Enregistrer les informations', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Enregistrer les informations', exact: true }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Relire la fiche enregistrée', exact: true }).click();
  await expect(dialog.getByLabel('Raison sociale', { exact: true })).toHaveValue(
    'Ateliers du Fleuve Inc.',
  );
  await expect(dialog.getByLabel('Valeur complémentaire 1')).toHaveValue('CF-2026-48');
  await expect(
    dialog.getByRole('button', { name: 'Enregistrer les informations', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('party-profile-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByLabel('Raison sociale', { exact: true }).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('party-profile-mobile.png') });
  expect(errors).toEqual([]);
});
test('Identity review: explicit searchable selection, confirmation and no profile copy', async ({
  page,
}, testInfo) => {
  const f = await fixture(page),
    dialog = await open(page, f.partner.name);
  await dialog.getByRole('button', { name: 'Rapprochement', exact: true }).click();
  await dialog.getByRole('button', { name: /^Client à rapprocher :/ }).click();
  const picker = page.getByRole('dialog', { name: 'Client à rapprocher', exact: true });
  await picker.getByRole('textbox').fill(f.customer.name);
  await picker.getByRole('option', { name: f.customer.name, exact: true }).click();
  await dialog
    .getByLabel('Motif du rapprochement', { exact: true })
    .fill('Identité confirmée avec le client');
  await dialog.getByRole('button', { name: 'Vérifier le rapprochement', exact: true }).click();
  await expect(
    dialog.getByText(`À confirmer : ${f.customer.name} · Aucune société CRM liée`, { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('party-identity-review.png') });
  await dialog.getByRole('button', { name: 'Confirmer les liens', exact: true }).click();
  await expect(dialog.getByText(f.customer.name, { exact: true }).first()).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Confirmer les liens', exact: true }),
  ).toHaveCount(0);
  const read = await page.request.get(`/api/v1/clients/data/partners/${f.partner.id}/identity`, {
    headers: f.headers,
  });
  const value = await read.json();
  expect(value.groups.find((g: any) => g.family === 'customer').records[0].id).toBe(f.customer.id);
});
test('Read-only profile and permission-filtered identity overview', async ({ page }) => {
  const f = await fixture(page),
    dialog = await open(page, f.partner.name, 'reader');
  await expect(dialog.getByLabel('Raison sociale', { exact: true })).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Enregistrer les informations', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Rapprochement', exact: true }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Client Transport / Facturation', exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Société CRM', exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: 'Vérifier le rapprochement', exact: true }),
  ).toHaveCount(0);
});
