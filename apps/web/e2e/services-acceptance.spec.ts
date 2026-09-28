import { test, expect, type Page } from './fixtures';
import { login } from './helpers';
const tenant = process.env.SERVICE_ACCEPTANCE_TENANT;
test.skip(!tenant, 'Run the isolated services-acceptance HTTP fixtures first.');
test.use({ reducedMotion: 'reduce' });
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});

async function fixture(page: Page, billable = false) {
  const session = await page.request.post('/api/v1/auth/login', { data: credentials() });
  expect(session.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  async function post(path: string, data: object, h = headers) {
    const r = await page.request.post(`/api/v1/${path}`, { headers: h, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  }
  const customers = await (
    await page.request.get('/api/v1/services/references/customers', { headers })
  ).json();
  let project = await post('services/projects', {
    title: `Recette acceptation ${Date.now()}`,
    partnerId: customers.items[0].id,
    acceptanceRequired: true,
  });
  project = await post(`services/projects/${project.id}/transition`, {
    status: 'ACTIVE',
    expectedUpdatedAt: project.updatedAt,
  });
  let job = await post('services/jobs', {
    title: 'Mise en service du réseau',
    projectId: project.id,
  });
  job = await post(`services/jobs/${job.id}/transition`, {
    status: 'IN_PROGRESS',
    expectedUpdatedAt: job.updatedAt,
  });
  job = await post(`services/jobs/${job.id}/transition`, {
    status: 'COMPLETED',
    expectedUpdatedAt: job.updatedAt,
    report: 'Réseau testé en présence du client. Les réserves restent à examiner.',
  });
  if (billable) {
    const planner = await (
      await page.request.post('/api/v1/auth/login', { data: credentials('planner') })
    ).json();
    const ph = { Authorization: `Bearer ${planner.accessToken}` };
    let time = await post(
      'services/time-entries',
      {
        jobId: job.id,
        userId: planner.user.id,
        workDate: '2026-09-27',
        minutes: 31,
        billable: true,
        note: 'Vérification client',
        operationKey: crypto.randomUUID(),
      },
      ph,
    );
    time = await post(
      `services/time-entries/${time.id}/review`,
      { action: 'SUBMIT', expectedUpdatedAt: time.updatedAt },
      ph,
    );
    await post(`services/time-entries/${time.id}/review`, {
      action: 'APPROVE',
      expectedUpdatedAt: time.updatedAt,
    });
  }
  return { job, project, headers };
}

test('required acceptance links from billing, records a decision and adapts to mobile', async ({
  page,
}, info) => {
  const f = await fixture(page, true);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, credentials());
  await page.goto(`/services/projects/${f.project.id}`);
  const billing = page.getByRole('region', { name: 'Facturation du projet' });
  await expect(billing.getByRole('checkbox')).toBeDisabled();
  await billing.getByRole('link', { name: 'Ouvrir l’acceptation de l’intervention' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/services/interventions\\?jobId=${f.job.id}&section=acceptance`),
  );
  const panel = page.getByRole('region', { name: 'Acceptation des travaux' });
  await expect(panel.getByRole('heading', { name: 'Compte rendu à examiner' })).toBeVisible();
  await panel.getByLabel('Réponse du client').selectOption('ACCEPTED');
  await panel.getByLabel('Représentant du client').fill('Camille Roy');
  await panel.getByLabel('Référence de l’échange').fill('Procès-verbal de recette réseau');
  await panel
    .getByLabel('Conclusion et levée des réserves')
    .fill('Tous les contrôles prévus sont acceptés.');
  await panel.getByRole('checkbox').check();
  await page.screenshot({ path: info.outputPath('services-acceptance-desktop.png') });
  await panel.getByRole('button', { name: 'Consigner la décision' }).click();
  await expect(panel.getByRole('heading', { name: 'Historique · 1' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Consigner la décision' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await panel
    .getByRole('heading', { name: 'Acceptation des travaux', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('services-acceptance-mobile.png') });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Fermer', exact: true })
    .last()
    .click();
  await page.goto(`/services/projects/${f.project.id}`);
  await expect(
    page.getByRole('region', { name: 'Facturation du projet' }).getByRole('checkbox'),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});

test('a lost response survives reload and replays the same decision without duplicates', async ({
  page,
}) => {
  const f = await fixture(page);
  await login(page, credentials());
  await page.goto(`/services/interventions?jobId=${f.job.id}&section=acceptance`);
  const panel = page.getByRole('region', { name: 'Acceptation des travaux' });
  await panel.getByLabel('Représentant du client').fill('Jordan Pelletier');
  await panel.getByLabel('Référence de l’échange').fill('Réunion de réception');
  await panel.getByLabel('Réserves et suites attendues').fill('Revoir un étiquetage.');
  await panel.getByRole('checkbox').check();
  const bodies: string[] = [];
  let lost = false;
  await page.route(`**/api/v1/services/jobs/${f.job.id}/acceptance`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postData()!);
    if (!lost) {
      lost = true;
      const result = await route.fetch();
      expect(result.ok()).toBeTruthy();
      await route.abort('failed');
    } else await route.continue();
  });
  await panel.getByRole('button', { name: 'Consigner la décision' }).click();
  await expect(
    panel.getByRole('button', { name: 'Reprendre la décision conservée' }),
  ).toBeVisible();
  await page.reload();
  await panel.getByRole('button', { name: 'Reprendre la décision conservée' }).click();
  await expect(panel.getByRole('heading', { name: 'Historique · 1' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Reprendre la décision conservée' })).toHaveCount(
    0,
  );
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  const history = await (
    await page.request.get(`/api/v1/services/jobs/${f.job.id}/acceptance`, { headers: f.headers })
  ).json();
  expect(history.total).toBe(1);
});

test('limited role sees history but no decision form; failed read clears stale data', async ({
  page,
}) => {
  const f = await fixture(page);
  await login(page, credentials('reader'));
  await page.goto(`/services/interventions?jobId=${f.job.id}&section=acceptance`);
  const panel = page.getByRole('region', { name: 'Acceptation des travaux' });
  await expect(panel.getByText(/Lecture seule/)).toBeVisible();
  await expect(panel.getByLabel('Représentant du client')).toHaveCount(0);
  await page.route(`**/api/v1/services/jobs/${f.job.id}/acceptance?*`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Recette : lecture indisponible' }),
    }),
  );
  await panel.getByRole('button', { name: 'Actualiser l’acceptation' }).click();
  await expect(panel.getByText('Recette : lecture indisponible')).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Historique · 0' })).toHaveCount(0);
});

test('project acceptance is optional at creation and locked after activation', async ({ page }) => {
  const f = await fixture(page);
  await login(page, credentials());
  await page.goto('/services');
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  let field = page.getByRole('checkbox', { name: 'Exiger l’acceptation des travaux' });
  await expect(field).not.toBeChecked();
  await expect(field).toBeEnabled();
  await field.check();
  await expect(field).toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.goto(`/services/projects/${f.project.id}`);
  await page.getByRole('button', { name: 'Modifier', exact: true }).click();
  field = page.getByRole('checkbox', { name: 'Exiger l’acceptation des travaux' });
  await expect(field).toBeChecked();
  await expect(field).toBeDisabled();
});
