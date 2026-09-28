import { test, expect, type APIRequestContext, type Page } from './fixtures';
import { login, DEMO_USER } from './helpers';
import { randomUUID } from 'node:crypto';

test.use({ timezoneId: 'America/Toronto' });
const prefix = `AV-UI-${Date.now()}`;
const credentials = {
  tenant: 'acme',
  email: `${prefix.toLowerCase()}@example.test`,
  password: 'Test1234!',
};
let adminToken: string,
  workerToken: string,
  worker: any,
  planner: any,
  employee: any,
  project: any,
  job: any,
  leave: any;
let errors: string[];
const headers = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
async function post(request: APIRequestContext, path: string, data: object, token = adminToken) {
  const response = await request.post('/api/v1/' + path, { headers: headers(token), data });
  expect(response.ok(), `${path}: ${response.status()}`).toBeTruthy();
  return response.json();
}
async function approveLeave(request: APIRequestContext) {
  leave = await post(
    request,
    'hr/self/leaves',
    {
      employeeId: employee.id,
      kind: 'OTHER',
      startDate: '2034-01-02',
      endDate: '2034-01-03',
      note: 'CONFIDENTIAL-RH-UI',
      operationKey: randomUUID(),
    },
    workerToken,
  );
  leave = await post(
    request,
    `hr/self/leaves/${leave.id}/transition`,
    { status: 'SUBMITTED', expectedUpdatedAt: leave.updatedAt, note: 'CONFIDENTIAL-REQUEST' },
    workerToken,
  );
  leave = await post(request, `hr/leaves/${leave.id}/transition`, {
    status: 'APPROVED',
    expectedUpdatedAt: leave.updatedAt,
    note: 'CONFIDENTIAL-DECISION',
  });
}
test.beforeAll(async ({ request }) => {
  adminToken = (await post(request, 'auth/login', DEMO_USER, '')).accessToken;
  for (const key of ['hr', 'services', 'catalog'])
    expect(
      (
        await request.patch(`/api/v1/modules/${key}`, {
          headers: headers(),
          data: { enabled: true },
        })
      ).ok(),
    ).toBeTruthy();
  for (const [key, permissions] of Object.entries({
    planner: ['services.read', 'services.manage', 'hr.availability.read'],
    worker: ['hr.self'],
    viewer: ['services.read'],
  })) {
    const role = await post(request, 'roles', {
      key: `${prefix.toLowerCase()}-${key}`,
      name: key,
      permissionKeys: permissions,
    });
    const person = await post(request, 'users', {
      email: key === 'planner' ? credentials.email : `${prefix.toLowerCase()}-${key}@example.test`,
      password: credentials.password,
      firstName: key === 'planner' ? 'Alex' : 'Camille',
      lastName: prefix,
      roleIds: [role.id],
    });
    if (key === 'planner') planner = person;
    else if (key === 'worker') worker = person;
  }
  workerToken = (
    await post(
      request,
      'auth/login',
      { ...credentials, email: `${prefix.toLowerCase()}-worker@example.test` },
      '',
    )
  ).accessToken;
  employee = await post(request, 'hr/employees', {
    code: prefix,
    firstName: 'Camille',
    lastName: prefix,
    jobTitle: 'Technicienne',
    teamId: null,
    userId: worker.id,
    active: true,
  });
  const partner = await post(request, 'catalog/partners', {
    code: prefix,
    name: prefix,
    isCustomer: true,
    isSupplier: false,
  });
  project = await post(request, 'services/projects', { title: prefix, partnerId: partner.id });
  project = await post(request, `services/projects/${project.id}/transition`, {
    status: 'ACTIVE',
    expectedUpdatedAt: project.updatedAt,
  });
  await approveLeave(request);
});
test.beforeEach(async ({ page, request }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (leave.status === 'CANCELLED') await approveLeave(request);
  job = await post(request, 'services/jobs', {
    projectId: project.id,
    title: `${prefix}-${randomUUID().slice(0, 8)}`,
    assigneeUserId: worker.id,
    scheduledAt: '2034-01-02T15:00:00Z',
  });
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  expect(errors).toEqual([]);
});
async function openJob(page: Page) {
  await login(page, credentials);
  await page.goto('/services/interventions');
  await page.getByLabel('Rechercher une intervention').fill(job.title);
  const row = page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: job.title, exact: true }) });
  await expect(row).toContainText('Absence approuvée ce jour');
  await row.click();
  return page.getByRole('region', { name: 'Contrôle RH de l’affectation', exact: true });
}

test('planner sees the warning without HR access and can replan from the same drawer', async ({
  page,
}) => {
  const preview = await openJob(page);
  await expect(preview).toContainText('Absence approuvée ce jour');
  await expect(preview).toContainText('America/Toronto');
  await expect(page.getByRole('link', { name: 'Employés', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('CONFIDENTIAL');
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog.locator('..')).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: 'test-results/services-availability-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByLabel('Date et heure prévues').fill('2034-01-04T10:00');
  await expect(preview).toContainText('Aucune absence approuvée ce jour');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button').filter({ hasText: job.title })).toContainText(
    'Aucune absence approuvée ce jour',
  );
});

test('a late preview cannot overwrite the new date result', async ({ page }) => {
  const preview = await openJob(page);
  await expect(preview).toContainText('Absence approuvée ce jour');
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/services/availability/check', async (route) => {
    const body = route.request().postDataJSON();
    if (body.items.length === 1 && body.items[0].scheduledAt === '2034-01-03T15:00:00.000Z') {
      const response = await route.fetch();
      started();
      await barrier;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await page.getByLabel('Date et heure prévues').fill('2034-01-03T10:00');
    await startedPromise;
    await page.getByLabel('Date et heure prévues').fill('2034-01-04T10:00');
    await expect(preview).toContainText('Aucune absence approuvée ce jour');
    release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(preview).toContainText('Aucune absence approuvée ce jour');
    await expect(preview).toContainText('2034-01-04');
  } finally {
    release();
  }
});

test('read failure is unknown, not available, and does not prevent saving work', async ({
  page,
}) => {
  const preview = await openJob(page);
  await expect(preview).toContainText('Absence approuvée ce jour');
  await page.route('**/services/availability/check', (route) =>
    route.fulfill({ status: 503, json: { message: 'Unavailable' } }),
  );
  await preview.getByRole('button', { name: 'Actualiser les absences' }).click();
  await expect(preview).toContainText('Non vérifié : contrôle RH indisponible');
  await expect(preview).not.toContainText('Aucune absence approuvée ce jour');
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('mobile shows unknown for a person without an RH record', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const preview = await openJob(page);
  await page.getByRole('button', { name: /Intervenant affecté :/ }).click();
  const picker = page.getByRole('dialog').last();
  await picker.getByPlaceholder('Rechercher par nom…').fill(prefix);
  await picker
    .getByRole('option')
    .filter({ hasText: `Alex ${prefix}` })
    .click();
  await expect(preview).toContainText('Non vérifié · aucun dossier RH lié');
  await expect(
    page.getByRole('button', { name: `Intervenant affecté : Alex ${prefix}`, exact: true }),
  ).toBeVisible();
  await preview.scrollIntoViewIfNeeded();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(dialog.locator('..')).toHaveCSS('opacity', '1');
  await page.screenshot({
    path: 'test-results/services-availability-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('refresh reflects cancelled RH leave without rewriting the job', async ({ page, request }) => {
  const preview = await openJob(page);
  await expect(preview).toContainText('Absence approuvée ce jour');
  leave = await post(request, `hr/leaves/${leave.id}/transition`, {
    status: 'CANCELLED',
    expectedUpdatedAt: leave.updatedAt,
    note: 'CONFIDENTIAL-CANCEL',
  });
  await preview.getByRole('button', { name: 'Actualiser les absences' }).click();
  await expect(preview).toContainText('Aucune absence approuvée ce jour');
  const current = await (
    await request.get(`/api/v1/services/jobs/${job.id}`, { headers: headers() })
  ).json();
  expect(current.updatedAt).toBe(job.updatedAt);
  expect(current.assigneeUserId).toBe(worker.id);
});

test('an unauthorized service reader sees unknown and never queries RH availability', async ({
  page,
}) => {
  let checks = 0;
  page.on('request', (r) => {
    if (r.url().includes('/services/availability/check')) checks++;
  });
  await login(page, { ...credentials, email: `${prefix.toLowerCase()}-viewer@example.test` });
  await page.goto('/services/interventions');
  await page.getByLabel('Rechercher une intervention').fill(job.title);
  await expect(page.getByRole('region', { name: 'Contrôle RH des interventions' })).toContainText(
    'droit hr.availability.read requis',
  );
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: job.title, exact: true }) })
    .click();
  await expect(page.getByRole('region', { name: 'Contrôle RH de l’affectation' })).toContainText(
    'droit hr.availability.read requis',
  );
  expect(checks).toBe(0);
});

test('page help and the replayable interactive Services tutorial explain the RH check', async ({
  page,
}) => {
  await login(page, credentials);
  await page.goto('/services/interventions');
  await page.getByRole('button', { name: 'Aide sur cette page' }).click();
  const help = page.getByRole('dialog', { name: 'Aide — Interventions' });
  await expect(help).toContainText('hr.availability.read');
  await expect(help).toContainText('pas toute l’entreprise');
  await help.getByRole('button', { name: 'Relancer le guide du module' }).click();
  const tour = page.getByRole('dialog');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Choisir l’exigence d’acceptation');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('les contraintes inconnues ne signifient pas disponible');
  await tour.getByRole('button', { name: 'Explorer : Planning', exact: true }).click();
  await expect(page).toHaveURL(/\/services\/planning$/);
});
