import { test, expect, type Page } from '@playwright/test';
import { login, DEMO_USER, tutorialAccount } from './helpers';
import { randomUUID } from 'node:crypto';
const prefix = `CON-${Date.now()}`;
let headers: Record<string, string>, partner: any, item: any, project: any, job: any, worker: any;
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
  const auth = await request.post('/api/v1/auth/login', { data: DEMO_USER });
  expect(auth.ok()).toBeTruthy();
  headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
  for (const key of ['catalog', 'services', 'hr', 'support', 'billing'])
    expect(
      (await request.patch(`/api/v1/modules/${key}`, { headers, data: { enabled: true } })).ok(),
    ).toBeTruthy();
  const create = async (path: string, data: object, h = headers) => {
    const r = await request.post('/api/v1/' + path, { headers: h, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  partner = await create('catalog/partners', {
    code: prefix,
    name: prefix + ' Client',
    isCustomer: true,
    isSupplier: false,
  });
  item = await create('catalog/items', {
    code: prefix,
    name: prefix + ' Main œuvre',
    kind: 'SERVICE',
    unit: 'H',
  });
  const account = await tutorialAccount(request);
  const session = await create('auth/login', account.credentials);
  worker = session.user;
  await create('hr/employees', {
    code: prefix,
    firstName: worker.firstName,
    lastName: worker.lastName,
    jobTitle: 'Technicien',
    userId: worker.id,
    teamId: null,
    active: true,
  });
  project = await create('services/projects', { title: prefix + ' Projet', partnerId: partner.id });
  project = await create(`services/projects/${project.id}/transition`, {
    status: 'ACTIVE',
    expectedUpdatedAt: project.updatedAt,
  });
  job = await create('services/jobs', {
    projectId: project.id,
    title: prefix + ' Visite',
    assigneeUserId: worker.id,
    scheduledAt: '2032-01-05T14:00:00Z',
    plannedMinutes: 60,
  });
  const activeJob = await create('services/jobs', {
    projectId: project.id,
    title: prefix + ' Travail réalisé',
    assigneeUserId: worker.id,
  });
  await create(`services/jobs/${activeJob.id}/transition`, {
    status: 'IN_PROGRESS',
    expectedUpdatedAt: activeJob.updatedAt,
  });
  let time = await create(
    'services/time-entries',
    {
      jobId: activeJob.id,
      userId: worker.id,
      workDate: '2026-09-21',
      minutes: 90,
      billable: true,
      note: 'Essai de facturation UI',
      operationKey: randomUUID(),
    },
    account.headers,
  );
  time = await create(
    `services/time-entries/${time.id}/review`,
    { action: 'SUBMIT', expectedUpdatedAt: time.updatedAt },
    account.headers,
  );
  await create(`services/time-entries/${time.id}/review`, {
    action: 'APPROVE',
    expectedUpdatedAt: time.updatedAt,
  });
  await create('support/cases', {
    partnerId: partner.id,
    title: prefix + ' SAV',
    description: 'Vérifier installation',
    priority: 'HIGH',
    operationKey: randomUUID(),
  });
});
async function pick(page: Page, label: string, text: string) {
  await page.getByRole('button', { name: new RegExp(label + ' :') }).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByPlaceholder('Rechercher par nom…').fill(text);
  await dialog.getByRole('option').filter({ hasText: text }).click();
}
test('quote editor accepts a saved offer into a single linked project', async ({ page }) => {
  await login(page);
  await page.goto('/services/quotes');
  await page.getByRole('button', { name: 'Nouveau devis', exact: true }).click();
  await page.getByLabel('Titre', { exact: true }).fill(prefix + ' Offre');
  await pick(page, 'Client', partner.name);
  await pick(page, 'Prestation à ajouter', item.name);
  await page.getByLabel('Quantité', { exact: true }).fill('1.5');
  await page.getByLabel('Prix unitaire', { exact: true }).fill('80');
  await page.getByRole('button', { name: 'Ajouter la ligne', exact: true }).click();
  await page.getByRole('button', { name: 'Enregistrer le devis', exact: true }).click();
  await page.getByRole('button', { name: 'Accepter le devis enregistré' }).click();
  await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Accepté — prix figés');
  await expect(page.getByRole('dialog')).toContainText('120 CAD');
  await page
    .getByRole('dialog')
    .getByRole('link', { name: /Ouvrir PRJ/ })
    .click();
  await expect(page).toHaveURL(/\/services\/projects\//);
  await expect(page.getByRole('button', { name: 'Activer le projet' })).toBeVisible();
});
test('mapping and source billing create an existing invoice draft', async ({ page }) => {
  await login(page);
  await page.goto('/catalog/partners');
  await page.getByRole('textbox', { name: 'Rechercher dans le catalogue' }).fill(partner.name);
  await page.getByRole('button', { name: `Connexions de ${partner.name}` }).click();
  await page
    .getByRole('button', { name: 'Créer le client de facturation depuis cette fiche' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Créer le client de facturation depuis cette fiche' }),
  ).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/services/projects/${project.id}`);
  const billing = page.getByRole('region', { name: 'Facturation du projet' });
  await billing.getByRole('checkbox').first().check();
  await billing.getByLabel('Prix / H').fill('80');
  await billing.getByRole('button', { name: /Préparer la facture brouillon/ }).click();
  await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
  await expect(billing).toContainText('Aucune source facturable actuellement');
  await billing.getByRole('link', { name: 'Ouvrir la facture brouillon', exact: true }).click();
  await expect(page).toHaveURL(/\/invoices\?.*statement=/);
  await expect(page.getByRole('dialog')).toBeVisible();
});
test('planning checks and confirms changes, with a real weekly board', async ({
  page,
  request,
}) => {
  await login(page);
  await page.goto('/services/planning');
  await page.getByLabel('Début de la période').fill('2032-01-05');
  await expect(page.getByRole('button').filter({ hasText: job.title })).toBeVisible();
  await page.getByRole('button').filter({ hasText: job.title }).click();
  await page.getByLabel('Début dans le fuseau de l’entreprise').fill('2032-01-05T10:00');
  await page.getByLabel('Durée prévue (minutes)').fill('90');
  await page.getByRole('button', { name: 'Vérifier le créneau', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Aucun conflit détecté');
  await page.getByRole('button', { name: 'Confirmer la planification', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const r = await request.get(`/api/v1/services/jobs/${job.id}`, { headers });
  expect((await r.json()).scheduledAt).toBe('2032-01-05T15:00:00.000Z');
  await page.screenshot({ path: 'test-results/connected-planning.png', fullPage: true });
});
test('workbench shows source alerts and AI prepares without submitting automatically', async ({
  page,
}) => {
  await login(page);
  await page.goto('/workbench');
  const feed = page.getByRole('region', { name: 'Suivi métier connecté' });
  await expect(feed.getByRole('heading', { name: 'À traiter dans mes modules' })).toBeVisible();
  await expect(feed.getByRole('button', { name: /SAV/ })).toBeVisible();
  await feed.getByRole('button', { name: 'Analyser avec un agent', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Lisez la demande avant de l’envoyer');
});
