import { test, expect, type Page } from './fixtures';
import { login, DEMO_USER, tutorialAccount } from './helpers';
import { randomUUID } from 'node:crypto';
const prefix = `RH-UI-${Date.now()}`,
  selfCredentials = {
    tenant: 'acme',
    email: `${prefix.toLowerCase()}@example.test`,
    password: 'Test1234!',
  };
let token: string, employee: any, selfSession: any;
let errors: string[];
const headers = () => ({ Authorization: `Bearer ${token}` });
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  expect(errors).toEqual([]);
});
test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/v1/auth/login', { data: DEMO_USER });
  expect(auth.ok()).toBeTruthy();
  token = (await auth.json()).accessToken;
  expect(
    (
      await request.patch('/api/v1/modules/hr', { headers: headers(), data: { enabled: true } })
    ).ok(),
  ).toBeTruthy();
  const role = await request.post('/api/v1/roles', {
    headers: headers(),
    data: { key: prefix.toLowerCase(), name: 'RH personnel UI', permissionKeys: ['hr.self'] },
  });
  expect(role.ok()).toBeTruthy();
  const user = await request.post('/api/v1/users', {
    headers: headers(),
    data: {
      email: selfCredentials.email,
      password: selfCredentials.password,
      firstName: 'Camille',
      lastName: prefix,
      roleIds: [(await role.json()).id],
    },
  });
  expect(user.ok()).toBeTruthy();
  const emp = await request.post('/api/v1/hr/employees', {
    headers: headers(),
    data: {
      code: prefix,
      firstName: 'Camille',
      lastName: prefix,
      jobTitle: 'Technicienne',
      teamId: null,
      userId: (await user.json()).id,
      active: true,
    },
  });
  expect(emp.ok()).toBeTruthy();
  employee = await emp.json();
  const own = await request.post('/api/v1/auth/login', { data: selfCredentials });
  expect(own.ok()).toBeTruthy();
  selfSession = await own.json();
});
async function pick(page: Page, label: string, name: string) {
  await page.getByRole('button', { name: new RegExp(label + ' :') }).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByPlaceholder('Rechercher par nom…').fill(name);
  await dialog.getByRole('option').filter({ hasText: name }).click();
}
test('manages teams and employee records using Pulsar drawers', async ({ page }) => {
  await login(page);
  await page.goto('/hr/teams');
  await page.getByRole('button', { name: 'Nouvelle équipe', exact: true }).click();
  await page.getByLabel('Code équipe', { exact: true }).fill(prefix + '-TEAM');
  await page.getByLabel('Nom de l’équipe').fill(prefix + ' Atelier');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/hr/employees');
  await page.getByRole('button', { name: 'Nouvel employé', exact: true }).click();
  await page.getByLabel('Matricule').fill(prefix + '-NEW');
  await page.getByLabel('Prénom', { exact: true }).fill('Alex');
  await page.getByLabel('Nom', { exact: true }).fill(prefix);
  await page.getByLabel('Poste', { exact: true }).fill('Atelier');
  await pick(page, 'Équipe', prefix + ' Atelier');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Rechercher', { exact: true }).fill(prefix + '-NEW');
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  await expect(page.getByLabel('Matricule')).toBeDisabled();
  await page.getByLabel('Poste', { exact: true }).fill('Responsable atelier');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: /Responsable atelier/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/hr-employees-desktop.png', fullPage: true });
});
test('self service submits, a different human approves and the original user sees the decision', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  await login(page, selfCredentials);
  await page.goto('/hr/self');
  await expect(page.getByText(`Camille ${prefix} · ${prefix}`)).toBeVisible();
  await page.getByRole('button', { name: 'Nouvelle demande', exact: true }).click();
  await page.getByLabel('Début inclus').fill('2033-10-12');
  await page.getByLabel('Fin incluse').fill('2033-10-13');
  await page.getByLabel('Note professionnelle').fill('Repos planifié UI');
  await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Soumettre', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Confirmer la décision RH' });
  await modal.getByLabel('Motif de la décision').fill('Demande personnelle');
  await modal.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Approuver', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Fermer le dossier', exact: true }).click();
  const list = await request.get('/api/v1/hr/self/leaves', {
    headers: { Authorization: `Bearer ${selfSession.accessToken}` },
  });
  const leave = (await list.json()).items.find((r: any) => r.note === 'Repos planifié UI');
  expect(leave.status).toBe('SUBMITTED');
  await page.evaluate(() => localStorage.removeItem('pulsar.auth'));
  await login(page);
  await page.goto('/hr/leaves');
  await page.getByLabel('État des absences').selectOption('SUBMITTED');
  const row = page.getByRole('row').filter({ hasText: leave.number });
  await row.getByRole('button', { name: 'Ouvrir', exact: true }).click();
  await page.getByRole('button', { name: 'Approuver', exact: true }).click();
  await modal.getByLabel('Motif de la décision').fill('Organisation vérifiée');
  await modal.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /ABS-.*Approuvée/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/hr-leave-approved-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Fermer le dossier', exact: true }).click();
  await page.evaluate(() => localStorage.removeItem('pulsar.auth'));
  await login(page, selfCredentials);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/hr/self');
  await page
    .getByRole('row')
    .filter({ hasText: leave.number })
    .getByRole('button', { name: 'Ouvrir' })
    .click();
  await expect(page.getByText('Organisation vérifiée', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
  await expect(page.getByRole('dialog').locator('..')).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: 'test-results/hr-self-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
});
test('resumes a lost creation after reload without duplicating the leave', async ({
  page,
  request,
}) => {
  await login(page, selfCredentials);
  await page.goto('/hr/self');
  await page.route(
    '**/api/v1/hr/self/leaves',
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort('failed');
    },
    { times: 1 },
  );
  // Register only after list is loaded, so the interceptor is consumed by POST rather than initial GET.
  await page.getByRole('button', { name: 'Nouvelle demande', exact: true }).click();
  await page.getByLabel('Début inclus').fill('2033-11-12');
  await page.getByLabel('Fin incluse').fill('2033-11-12');
  await page.getByLabel('Note professionnelle').fill('Reprise sans doublon');
  await page.getByRole('button', { name: 'Créer le brouillon' }).click();
  await expect(
    page.getByRole('button', { name: 'Reprendre exactement cette demande' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la demande conservée' }).click();
  await page.getByRole('button', { name: 'Reprendre exactement cette demande' }).click();
  await expect(page.getByRole('button', { name: 'Soumettre', exact: true })).toBeEnabled();
  const list = await request.get('/api/v1/hr/self/leaves', {
    headers: { Authorization: `Bearer ${selfSession.accessToken}` },
  });
  expect(
    (await list.json()).items.filter((r: any) => r.note === 'Reprise sans doublon'),
  ).toHaveLength(1);
});
test('first HR visit starts the interactive tour, explores real screens and persists completion', async ({
  page,
  request,
}) => {
  const account = await tutorialAccount(request);
  await login(page, account.credentials);
  // This isolated account is genuinely new: read/write real preferences, without
  // the experienced-user snapshot or a fetch interceptor racing page reloads.
  await page.unroute('**/api/v1/me/preferences');
  await page.goto('/hr');
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Bienvenue dans Ressources humaines');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Explorer : Employés', exact: true }).click();
  await expect(page).toHaveURL(/\/hr\/employees$/);
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Explorer : Absences d’équipe', exact: true }).click();
  await expect(page).toHaveURL(/\/hr\/leaves$/);
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Explorer : Mes absences', exact: true }).click();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Explorer : Compétences', exact: true }).click();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Explorer : Habilitations', exact: true }).click();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Terminer', exact: true }).click();
  await expect(tour).toHaveCount(0);
  const prefs = await request.get('/api/v1/me/preferences', { headers: account.headers });
  expect((await prefs.json()).moduleTours.hr).toMatchObject({
    version: 2,
    step: 6,
    status: 'COMPLETED',
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Habilitations', exact: true })).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.goto('/documentation?module=hr');
  await expect(page.getByRole('article')).toContainText(
    'Une équipe inactive ne peut pas être sélectionnée',
  );
  await expect(page.getByRole('article')).toContainText('Le planning Services ajoute une durée');
});
test('a self-only user sees no team records or decision controls', async ({ page, request }) => {
  await login(page, selfCredentials);
  await page.goto('/hr');
  await expect(page.getByRole('link', { name: 'Employés', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mes absences', exact: true }).first()).toBeVisible();
  const forbidden = await request.get('/api/v1/hr/employees', {
    headers: { Authorization: `Bearer ${selfSession.accessToken}` },
  });
  expect(forbidden.status()).toBe(403);
  const response = await request.post('/api/v1/hr/self/leaves', {
    headers: { Authorization: `Bearer ${selfSession.accessToken}` },
    data: {
      employeeId: employee.id,
      kind: 'TIME_OFF',
      startDate: '2033-12-01',
      endDate: '2033-12-01',
      note: '',
      operationKey: randomUUID(),
    },
  });
  expect(response.ok()).toBeTruthy();
});
