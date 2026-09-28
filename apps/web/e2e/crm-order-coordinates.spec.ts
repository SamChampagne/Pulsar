import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.CRM_COORDINATES_TENANT;
test.skip(!tenant, 'Run crm-order-coordinates HTTP fixtures on the isolated database first.');
test.use({ reducedMotion: 'reduce' });

test('CRM alone: company directory, uncertain selection and confirmation, frozen mobile view', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const credentials = { tenant: tenant!, email: `manager@${tenant}.test`, password: 'Test1234!' };
  const session = await page.request.post('/api/v1/auth/login', { data: credentials });
  expect(session.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const call = async (method: 'post' | 'get' | 'patch', path: string, data?: unknown) => {
    const r = await page.request[method](`/api/v1${path}`, { headers, ...(data ? { data } : {}) });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const company = await call('post', '/crm/companies', { name: `Atelier autonome ${Date.now()}` });
  const order = await call('post', '/crm/sales-orders', { companyId: company.id });
  await call('post', `/crm/sales-orders/${order.id}/line-items`, {
    name: 'Installation',
    quantity: 2,
    unitPrice: 150,
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials);
  await page.goto(`/crm/companies/${company.id}`);
  await page.getByRole('button', { name: 'Adresses et contacts du carnet', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: `Carnet · ${company.name}`, exact: true });
  await drawer.getByRole('button', { name: 'Ajouter une adresse', exact: true }).click();
  await drawer.getByLabel('Nom du site / adresse').fill('Bureau commercial');
  await drawer.getByLabel('Rue et numéro').fill('42 rue du Parc');
  await drawer.getByLabel('Ville', { exact: true }).fill('Québec');
  await drawer.getByLabel('Code postal').fill('G1K 3X2');
  await drawer.getByLabel('Motif de la modification').fill('Adresse revue avec la société');
  await drawer.getByRole('button', { name: 'Enregistrer la version', exact: true }).click();
  await expect(
    drawer.getByRole('heading', { name: 'Bureau commercial', exact: true }),
  ).toBeVisible();
  let failedRead = false;
  await page.route(`**/api/v1/crm/sales-orders/${order.id}/coordinates`, async (route) => {
    if (route.request().method() === 'GET' && !failedRead) {
      failedRead = true;
      await route.fulfill({
        status: 503,
        json: { message: 'Lecture temporairement indisponible' },
      });
    } else await route.continue();
  });
  await page.goto(`/crm/sales-orders/${order.id}`);
  const coordinates = page.getByRole('region', { name: 'Coordonnées du document', exact: true });
  await expect(coordinates.getByRole('alert')).toContainText('Lecture temporairement indisponible');
  await expect(page.getByRole('button', { name: 'Confirmer', exact: true })).toBeDisabled();
  await coordinates.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await coordinates
    .getByRole('button', { name: 'Choisir / revoir les coordonnées', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Confirmer', exact: true })).toBeDisabled();
  await coordinates.getByRole('button', { name: 'Choisir Bureau commercial', exact: true }).click();
  await coordinates.getByLabel('Motif du choix / changement').fill('Adresse de cet accord');
  let lostSelection = false;
  await page.route(`**/api/v1/crm/sales-orders/${order.id}/coordinates`, async (route) => {
    if (route.request().method() === 'PATCH' && !lostSelection) {
      lostSelection = true;
      const r = await route.fetch();
      expect(r.ok()).toBeTruthy();
      await route.abort();
    } else await route.continue();
  });
  await coordinates
    .getByRole('button', { name: 'Enregistrer les coordonnées', exact: true })
    .click();
  await expect(
    coordinates.getByRole('button', { name: 'Vérifier le document enregistré', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmer', exact: true })).toBeDisabled();
  await coordinates
    .getByRole('button', { name: 'Vérifier le document enregistré', exact: true })
    .click();
  await expect(coordinates).toContainText('Sélection enregistrée');
  await expect(coordinates).toContainText('Bureau commercial');
  await page.screenshot({
    path: testInfo.outputPath('crm-coordinates-desktop.png'),
    fullPage: true,
  });
  let confirmations = 0;
  await page.route(`**/api/v1/crm/sales-orders/${order.id}/confirm`, async (route) => {
    confirmations++;
    const r = await route.fetch();
    expect(r.ok()).toBeTruthy();
    await route.abort();
  });
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmer la commande', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Vérifier le statut enregistré', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Vérifier le statut enregistré', exact: true }).click();
  await expect(coordinates).toContainText('Copie figée');
  expect(confirmations).toBe(1);
  await call('patch', `/crm/companies/${company.id}`, {
    name: 'Société renommée après engagement',
  });
  await page.reload();
  await expect(coordinates).toContainText(company.name);
  await expect(
    coordinates.getByRole('button', { name: 'Choisir / revoir les coordonnées', exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await coordinates.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('crm-coordinates-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test('CRM first-entry tour, documentation and reader-only directory', async ({ page }) => {
  await login(page, { tenant: tenant!, email: `reader@${tenant}.test`, password: 'Test1234!' });
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto('/crm/companies');
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Partir de la société commerciale');
  for (let i = 0; i < 4; i++)
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Engager une version vérifiée');
  await expect(tour).toContainText('Vérifier le statut enregistré');
  await tour.getByRole('button', { name: 'Passer le tutoriel', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sociétés', exact: true })).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.goto('/documentation?module=crm');
  await expect(page.getByText(/Autonomie : les sociétés possèdent leur carnet/)).toContainText(
    'Seuls CRM',
  );
  await expect(page.getByText(/La devise ne change plus après confirmation/)).toBeVisible();
  // The dedicated manager's fixture is visible, but no write controls are offered.
  await page.goto('/crm/sales-orders');
  await page.getByRole('cell', { name: /^SO-/ }).first().click();
  const coordinates = page.getByRole('region', { name: 'Coordonnées du document', exact: true });
  await expect(coordinates).toBeVisible();
  await expect(
    coordinates.getByRole('button', { name: 'Choisir / revoir les coordonnées', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Carnet de la société', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Ajouter une adresse', exact: true }),
  ).toHaveCount(0);
});
