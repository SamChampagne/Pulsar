import { expect, test } from './fixtures';
import { login } from './helpers';

test('configure a pipeline and its stage actions, move a deal, inspect follow-up and mobile layout', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('pulsar.auth')!));
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const suffix = `Pipeline UI ${Date.now()}`;
  await page.request.patch('/api/v1/modules/crm', { headers, data: { enabled: true } });
  const company = await page.request.post('/api/v1/crm/companies', {
    headers,
    data: { name: suffix },
  });
  expect(company.ok()).toBeTruthy();
  const companyId = (await company.json()).id;
  const contact = await page.request.post('/api/v1/crm/contacts', {
    headers,
    data: { name: suffix + ' contact', companyId, email: `pipeline-ui-${Date.now()}@example.test` },
  });
  expect(contact.ok()).toBeTruthy();
  const contactId = (await contact.json()).id;

  await page.goto('/crm/pipeline');
  await page.getByRole('button', { name: 'Nouveau pipeline', exact: true }).click();
  await page.getByLabel('Nom du nouveau pipeline').fill(suffix);
  await page.getByRole('button', { name: 'Créer le pipeline', exact: true }).click();
  await expect(page.getByLabel('Pipeline actif')).toContainText(suffix);
  await expect(page.getByLabel('Pipeline actif')).toHaveValue(/.+/);
  const pipelineId = new URL(page.url()).searchParams.get('pipelineId')!;
  expect(pipelineId).toBeTruthy();
  await page.getByRole('button', { name: 'Configurer les colonnes' }).click();
  await page.getByLabel('Nom de la colonne 3', { exact: true }).fill('Proposition envoyée');
  await page.getByRole('button', { name: 'Ajouter une colonne' }).click();
  await page.getByLabel('Nom de la colonne 6', { exact: true }).fill('Relance personnalisée');
  await page.getByRole('button', { name: 'Monter Relance personnalisée' }).click();
  await page.getByRole('button', { name: 'Enregistrer le pipeline' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pipeline enregistré' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Automatisations de Proposition envoyée', exact: true })
    .click();
  const editor = page.getByRole('region', { name: 'Automatisations de Proposition envoyée' });
  await expect(editor.getByLabel('Mode des actions')).toHaveValue('SIMULATION');
  await editor.getByLabel('Objet du courriel 1').fill('Proposition — ' + suffix);
  await editor.getByRole('checkbox').check();
  await editor.getByRole('button', { name: 'Enregistrer les actions' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Actions de la colonne enregistrées' }),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Fermer les actions' }).click();

  const pipelines = await page.request.get('/api/v1/crm/pipelines', { headers });
  const pipeline = (await pipelines.json()).find((p: any) => p.id === pipelineId);
  const target = pipeline.stages.find((s: any) => s.name === 'Proposition envoyée');
  const dealResponse = await page.request.post('/api/v1/crm/deals', {
    headers,
    data: {
      title: suffix + ' affaire',
      companyId,
      primaryContactId: contactId,
      pipelineId,
      pipelineStageId: pipeline.stages[0].id,
    },
  });
  expect(dealResponse.ok()).toBeTruthy();
  const deal = await dealResponse.json();
  await page.reload();
  await page.getByLabel('Déplacer ' + deal.title).selectOption(target.id);
  await expect(
    page
      .getByRole('region', { name: 'Colonne Proposition envoyée', exact: true })
      .getByRole('link', { name: deal.title }),
  ).toBeVisible();
  await page.screenshot({ path: 'playwright-artifacts/crm-pipeline-desktop.png', fullPage: true });
  await page.getByRole('link', { name: deal.title, exact: true }).click();
  await expect(page.getByLabel('Contact principal des suivis')).toHaveValue(contactId);
  await expect(page.getByLabel('Étape de l’opportunité')).toHaveValue(target.id);
  // The real minute worker executes the simulation; no special test-only endpoint.
  await expect
    .poll(
      async () => {
        const result = await page.request.get('/api/v1/crm/sequences/runs', {
          headers,
          params: { dealId: deal.id },
        });
        const body = await result.json();
        return body.items[0]?.steps[0]?.status;
      },
      { timeout: 80000, intervals: [1000, 2000, 3000] },
    )
    .toBe('SIMULATED');
  await page.reload();
  await expect(page.getByText('Simulé', { exact: true })).toBeVisible();
  const followUp = pipeline.stages.find((s: any) => s.name === 'Relance personnalisée');
  await page.getByLabel('Étape de l’opportunité').selectOption(followUp.id);
  await expect(page.getByText('Arrêté', { exact: true })).toBeVisible();
  const runs = await page.request.get('/api/v1/crm/sequences/runs', {
    headers,
    params: { dealId: deal.id },
  });
  const run = (await runs.json()).items[0];
  const outbox = await page.request.get('/api/v1/emails', {
    headers,
    params: { relatedType: 'crm-sequence-step', relatedId: run.steps[0].id },
  });
  expect((await outbox.json()).total).toBe(0);
  await page.goto('/crm/pipeline?pipelineId=' + pipelineId);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('aside')
        .first()
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page
    .getByRole('button', { name: 'Automatisations de Proposition envoyée', exact: true })
    .click();
  await page.screenshot({
    path: 'playwright-artifacts/crm-pipeline-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  const sequence = (
    await (
      await page.request.get('/api/v1/crm/sequences', {
        headers,
        params: { search: 'Proposition envoyée', pageSize: 100 },
      })
    ).json()
  ).items.find((s: any) => s.pipelineStageId === target.id);
  await page.request.put('/api/v1/crm/sequences/' + sequence.id, {
    headers,
    data: {
      name: sequence.name,
      enabled: false,
      mode: sequence.mode,
      trigger: sequence.trigger,
      pipelineStageId: sequence.pipelineStageId,
      steps: sequence.steps,
    },
  });
});

test('connections hub distinguishes future connectors and reuses existing email settings', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.goto('/connect');
  await expect(page.getByRole('heading', { name: 'Connexions', exact: true })).toBeVisible();
  const sms = page.getByRole('article').filter({ hasText: 'Twilio — SMS' });
  await expect(sms.getByText('À développer', { exact: false })).toBeVisible();
  await expect(sms.getByRole('button')).toHaveCount(0);
  await page.screenshot({ path: 'playwright-artifacts/connections-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Configurer le courriel', exact: true }).click();
  await expect(page).toHaveURL(/\/connect\/email/);
  await expect(
    page.getByRole('heading', { name: 'Connexion courriel', exact: true }),
  ).toBeVisible();
  await page.goto('/emails/config');
  await expect(
    page.getByRole('heading', { name: 'Connexion courriel', exact: true }),
  ).toBeVisible();
  await page.goto('/connect');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('aside')
        .first()
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'playwright-artifacts/connections-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
