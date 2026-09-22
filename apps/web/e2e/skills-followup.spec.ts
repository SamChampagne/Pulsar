import { test, expect, type Page } from './fixtures';
import { login, DEMO_USER, tutorialAccount } from './helpers';
import { randomUUID } from 'node:crypto';
const prefix = 'SK-UI-' + Date.now();
let headers: Record<string, string>, employee: any, wc: any, client: any, me: any;
let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  expect(errors).toEqual([]);
});
test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/v1/auth/login', { data: DEMO_USER });
  expect(r.ok()).toBeTruthy();
  const session = await r.json();
  me = session.user;
  headers = { Authorization: `Bearer ${session.accessToken}` };
  for (const key of ['hr', 'quality', 'manufacturing', 'support', 'catalog', 'purchasing'])
    expect(
      (await request.patch(`/api/v1/modules/${key}`, { headers, data: { enabled: true } })).ok(),
    ).toBeTruthy();
  const create = async (path: string, data: object) => {
    const r = await request.post('/api/v1/' + path, { headers, data });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  employee = await create('hr/employees', {
    code: prefix,
    firstName: 'Alex',
    lastName: prefix,
    jobTitle: 'Opérateur',
    teamId: null,
    userId: null,
    active: true,
  });
  const calendar = await create('manufacturing/calendars', {
    code: prefix,
    name: prefix + ' Calendrier',
  });
  wc = await create('manufacturing/work-centers', {
    code: prefix,
    name: prefix + ' Poste',
    calendarId: calendar.id,
  });
  client = await create('catalog/partners', {
    code: prefix,
    name: prefix + ' Client',
    isCustomer: true,
    isSupplier: true,
  });
});
async function pick(page: Page, label: string, name: string) {
  await page.getByRole('button', { name: new RegExp(label + ' :') }).click();
  const modal = page.getByRole('dialog').last();
  await modal.getByPlaceholder('Rechercher par nom…').fill(name);
  await modal.getByRole('option').filter({ hasText: name }).click();
}
test('attests a qualification with lost-response recovery, checks manufacturing and revokes it', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page.goto('/hr/skills');
  await page.getByRole('button', { name: 'Nouvelle compétence', exact: true }).click();
  await page.getByLabel('Code', { exact: true }).fill(prefix);
  await page.getByLabel('Nom de la compétence').fill(prefix + ' Chariot');
  await page.getByLabel('Nature', { exact: true }).selectOption('AUTHORIZATION');
  await page.getByRole('button', { name: 'Enregistrer la compétence' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/hr/qualifications');
  await page.getByRole('button', { name: 'Attester une qualification', exact: true }).click();
  await pick(page, 'Employé à qualifier', prefix);
  await pick(page, 'Compétence à attester', prefix + ' Chariot');
  await page.getByLabel('Valide à partir du').fill('2034-01-01');
  await page.getByLabel('Valide jusqu’au (inclus)', { exact: true }).fill('2034-12-31');
  await page.getByLabel('Référence vérifiée').fill(prefix + ' Certificat vérifié');
  await page.getByRole('checkbox').check();
  await page.route(
    '**/api/v1/hr/qualifications',
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const r = await route.fetch();
      expect(r.ok()).toBeTruthy();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Confirmer l’attestation' }).click();
  await expect(
    page.getByRole('button', { name: 'Reprendre l’attestation conservée' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre l’attestation conservée' }).click();
  await expect(page.getByRole('button', { name: 'Reprendre l’attestation conservée' })).toHaveCount(
    0,
  );
  await page.getByLabel('Rechercher une habilitation').fill(prefix);
  await page.getByLabel('Validité à la date').fill('2034-12-31');
  await expect(page.getByRole('cell').filter({ hasText: 'Valide à cette date' })).toBeVisible();
  const r = await request.get('/api/v1/hr/qualifications', { headers, params: { search: prefix } });
  expect((await r.json()).total).toBe(1);
  await page.screenshot({ path: 'test-results/hr-qualifications.png', fullPage: true });
  await page.goto('/manufacturing/qualifications');
  await pick(page, 'Poste de charge à contrôler', wc.name);
  await pick(page, 'Compétence exigée', prefix + ' Chariot');
  await page.getByRole('button', { name: 'Ajouter l’exigence' }).click();
  await expect(page.getByRole('button', { name: 'Retirer', exact: true })).toBeVisible();
  await pick(page, 'Employé à vérifier', prefix);
  await page.getByLabel('Date prévue').fill('2034-12-31');
  await page.getByRole('button', { name: 'Vérifier les qualifications' }).click();
  await expect(page.locator('[aria-live="polite"]')).toContainText('Exigences couvertes');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/manufacturing-qualifications.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto('/hr/qualifications');
  await page.getByLabel('Rechercher une habilitation').fill(prefix);
  await page.getByRole('button', { name: 'Révoquer', exact: true }).click();
  await page.getByLabel('Motif de révocation').fill('Fin de validité anticipée vérifiée');
  await page.getByRole('button', { name: 'Confirmer la révocation' }).click();
  await expect(page.locator('tbody')).toContainText('Révoquée');
  await expect(page.getByRole('button', { name: 'Révoquer', exact: true })).toHaveCount(0);
});

test('qualification workspaces and help fit a narrow screen', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/hr/skills', '/hr/qualifications', '/manufacturing/qualifications']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name: 'Aide sur cette page' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await page.screenshot({ path: 'test-results/qualifications-mobile.png', fullPage: true });
});
test('SAV responsible and due date persist and feed open follow-up queues', async ({
  page,
  request,
}) => {
  let r = await request.post('/api/v1/support/cases', {
    headers,
    data: {
      partnerId: client.id,
      title: prefix + ' SAV',
      description: 'À diagnostiquer',
      priority: 'HIGH',
      operationKey: randomUUID(),
    },
  });
  expect(r.ok()).toBeTruthy();
  const row = await r.json();
  await login(page);
  await page.goto('/support');
  await page.getByLabel('Rechercher une demande SAV').fill(row.number);
  await page.getByRole('button', { name: row.number, exact: true }).click();
  await pick(page, 'Responsable SAV', me.firstName + ' ' + me.lastName);
  await page.getByLabel('Échéance SAV').fill('2000-01-01');
  await page.getByRole('button', { name: 'Enregistrer la demande' }).click();
  await expect(page.getByLabel('Échéance SAV')).toHaveValue('2000-01-01');
  await page.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page.getByRole('button', { name: 'Mes demandes à traiter', exact: true }).click();
  await expect(page.getByRole('button', { name: row.number, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Échéances dépassées', exact: true }).click();
  await expect(page.getByRole('button', { name: row.number, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sans responsable', exact: true }).click();
  await expect(page.getByRole('button', { name: row.number, exact: true })).toHaveCount(0);
});
test('upgraded HR lesson does not reopen automatically; help replay supports practice', async ({
  page,
  request,
}) => {
  const account = await tutorialAccount(request);
  for (const moduleKey of ['hr', 'dashboard']) {
    expect(
      (
        await request.put('/api/v1/me/preferences', {
          headers: account.headers,
          data: { moduleTour: { moduleKey, version: 1, step: 4, status: 'COMPLETED' } },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await login(page, account.credentials);
  await page.unroute('**/api/v1/me/preferences');
  await page.goto('/hr');
  const tour = page.getByTestId('module-tour');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(tour).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tutoriel métier', exact: true })).toHaveCount(0);
  const preferences = await request.get('/api/v1/me/preferences', { headers: account.headers });
  expect((await preferences.json()).moduleTours.hr).toMatchObject({
    version: 1,
    status: 'COMPLETED',
  });
  await page.getByRole('button', { name: 'Tutoriel du module', exact: true }).click();
  await expect(tour).toContainText('Étape 1 sur 7');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Pratiquer sur cet écran' }).click();
  await expect(page).toHaveURL(/\/hr\/employees$/);
  await expect(tour).toHaveCount(0);
  await page.getByRole('button', { name: 'Nouvel employé', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Reprendre mon parcours/ }).click({ force: true });
  await expect(tour).toHaveCount(0);
  await page.getByRole('button', { name: 'Abandonner et fermer', exact: true }).click();
  await page.getByRole('button', { name: /Reprendre mon parcours/ }).click();
  await expect(tour).toContainText('Préparer une équipe et un employé');
  await tour.getByRole('button', { name: 'Passer le tutoriel' }).click();
  await page.goto('/hr');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.getByRole('button', { name: 'Aide sur cette page' }).click();
  await page.getByRole('button', { name: 'Relancer le guide du module' }).click();
  await expect(tour).toContainText('Étape 1 sur 7');
  await tour.getByRole('button', { name: 'Passer le tutoriel' }).click();
  await page.getByRole('button', { name: 'Profil utilisateur' }).click();
  await page.getByRole('button', { name: 'Déconnexion', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  // Keep the SPA alive: a full navigation would hide a stale replay-store request.
  await page.getByLabel('Email').fill(account.credentials.email);
  await page.getByLabel('Password').fill(account.credentials.password);
  await page.getByLabel('Tenant (optional)').fill(account.credentials.tenant);
  const preferencesLoaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/me/preferences') && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  await preferencesLoaded;
  await expect(page).toHaveURL(/\/dashboard$/);
  // Observe past the guide's 200ms presentation timer, asserting it stays absent throughout.
  const quietUntil = Date.now() + 600;
  while (Date.now() < quietUntil) {
    await expect(tour).toHaveCount(0);
    await page.waitForTimeout(50);
  }
});

test('module homes have no business-tutorial banner or automatic replay for experienced users', async ({
  page,
}) => {
  await login(page);
  for (const path of ['/hr', '/quality', '/support', '/purchasing']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tutoriel métier', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('module-tour')).toHaveCount(0);
  }
});
