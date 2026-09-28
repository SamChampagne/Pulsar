import { test, expect, type Page } from './fixtures';
import { login, DEMO_USER, tutorialAccount } from './helpers';
import { randomUUID } from 'node:crypto';
let token: string, plan: any, support: any;
let errors: string[] = [];
const prefix = 'Q-UI-' + Date.now();
const headers = () => ({ Authorization: `Bearer ${token}` });
test.beforeEach(({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(async ({ page }) => {
  // Finish preference interceptors before Playwright disposes this page. Otherwise
  // a late first-visit read can be reported as a failure in the following test.
  await page.unrouteAll({ behavior: 'wait' });
  expect(errors).toEqual([]);
});
test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/v1/auth/login', { data: DEMO_USER });
  expect(auth.ok()).toBeTruthy();
  token = (await auth.json()).accessToken;
  for (const key of ['quality', 'support', 'catalog'])
    expect(
      (
        await request.patch(`/api/v1/modules/${key}`, {
          headers: headers(),
          data: { enabled: true },
        })
      ).ok(),
    ).toBeTruthy();
  const response = await request.post('/api/v1/quality/plans', {
    headers: headers(),
    data: {
      code: prefix,
      name: prefix + ' Plan',
      instructions: 'Vérifier l’aspect et mesurer le diamètre.',
      active: true,
      criteria: [
        { key: 'aspect', label: 'Aspect', kind: 'CHECK' },
        { key: 'diameter', label: 'Diamètre', kind: 'NUMBER', unit: 'mm', min: 9.8, max: 10.2 },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();
  plan = await response.json();
  const p = await request.post('/api/v1/catalog/partners', {
    headers: headers(),
    data: { code: prefix, name: prefix + ' Client', isCustomer: true, isSupplier: false },
  });
  expect(p.ok()).toBeTruthy();
  const s = await request.post('/api/v1/support/cases', {
    headers: headers(),
    data: {
      partnerId: (await p.json()).id,
      title: prefix + ' SAV',
      description: 'Pièce à inspecter',
      priority: 'NORMAL',
      operationKey: randomUUID(),
    },
  });
  expect(s.ok()).toBeTruthy();
  support = await s.json();
});
async function pick(page: Page, label: string, name: string) {
  await page.getByRole('button', { name: new RegExp(label + ' :') }).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByPlaceholder('Rechercher par nom…').fill(name);
  await dialog.getByRole('option').filter({ hasText: name }).click();
}
async function create(page: Page, title: string) {
  await page.getByRole('button', { name: 'Nouveau contrôle', exact: true }).click();
  await pick(page, 'Plan actif', plan.name);
  await page.getByLabel('Objet du contrôle').fill(title);
  await page.getByRole('button', { name: 'Créer le contrôle', exact: true }).click();
  await expect(page).toHaveURL(/\/quality\/inspections\//);
}
async function decision(page: Page, button: string, note = 'Vérification documentée') {
  await page.getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('textarea').fill(note);
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test('plans configure measures, retain revisions and can be deactivated', async ({ page }) => {
  await login(page);
  await page.goto('/quality/plans');
  await page.getByRole('button', { name: 'Nouveau plan', exact: true }).click();
  await page.getByLabel('Code du plan').fill(prefix + '-NEW');
  await page.getByLabel('Nom du plan').fill(prefix + ' Nouveau');
  await page.getByRole('button', { name: 'Ajouter un critère' }).click();
  await page.getByLabel('Libellé 2').fill('Température');
  await page.getByLabel('Type 2').selectOption('NUMBER');
  await page.getByLabel('Unité 2').fill('°C');
  await page.getByLabel('Minimum 2').fill('2');
  await page.getByLabel('Maximum 2').fill('8');
  await page.getByRole('button', { name: 'Enregistrer le plan', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Rechercher les plans').fill(prefix + ' Nouveau');
  await page.getByRole('button', { name: 'Modifier ' + prefix + ' Nouveau', exact: true }).click();
  await expect(page.getByLabel('Code du plan')).toBeDisabled();
  await page.getByLabel('Plan actif pour les nouveaux contrôles').uncheck();
  await page.getByRole('button', { name: 'Enregistrer le plan' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'v2', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Inactif', exact: true })).toBeVisible();
});
test('complete failure, cause, correction and verification retain the original result', async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page.goto('/quality');
  await create(page, prefix + ' Contrôle');
  await decision(page, 'Démarrer le contrôle');
  await expect(
    page.getByRole('button', { name: 'Terminer le contrôle', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Résultat : Aspect', { exact: true }).selectOption('PASS');
  await page.getByLabel('Mesure : Diamètre').fill('10.4');
  await page.getByLabel('Observation : Diamètre').fill('Mesure au pied à coulisse');
  await page.getByRole('button', { name: 'Enregistrer les résultats', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Terminer le contrôle', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: 'test-results/quality-inspection-desktop.png', fullPage: true });
  await decision(page, 'Terminer le contrôle', 'Diamètre hors tolérance');
  await expect(page.getByText('Contrôle non conforme', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Ouvrir NC-/ }).click();
  await decision(page, 'Prendre en traitement');
  await expect(page.getByRole('button', { name: 'Déclarer l’action réalisée' })).toBeDisabled();
  await page.getByLabel('Cause identifiée').fill('Outil usé');
  await page.getByLabel('Action corrective', { exact: true }).fill('Outil remplacé et réglé');
  await page.getByRole('button', { name: 'Enregistrer l’analyse' }).click();
  await expect(page.getByRole('button', { name: 'Déclarer l’action réalisée' })).toBeEnabled();
  await decision(page, 'Déclarer l’action réalisée');
  await decision(page, 'Vérifier et clôturer', 'Contre-mesure vérifiée sur une nouvelle pièce');
  await expect(page.getByLabel('Cause identifiée')).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Historique qualité' })).toContainText(
    'Contre-mesure vérifiée',
  );
  await page.getByRole('link', { name: 'Contrôle d’origine' }).click();
  await expect(page.getByText('Contrôle non conforme', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Mesure : Diamètre')).toHaveValue('10.4');
  await expect(page.getByLabel('Mesure : Diamètre')).toBeDisabled();
});
test('an uncertain creation can be resumed after reload with the same identity', async ({
  page,
  request,
}) => {
  await login(page);
  await page.goto('/quality');
  let operationKey = '';
  await page.route(
    '**/api/v1/quality/inspections',
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      operationKey = route.request().postDataJSON().operationKey;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Nouveau contrôle', exact: true }).click();
  await pick(page, 'Plan actif', plan.name);
  await page.getByLabel('Objet du contrôle').fill(prefix + ' Reprise');
  await page.getByRole('button', { name: 'Créer le contrôle', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('conservée');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Fermer', exact: true })
    .last()
    .click();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre le contrôle conservé', exact: true }).click();
  const replay = page.waitForRequest(
    (r) => r.url().endsWith('/quality/inspections') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Reprendre cette demande', exact: true }).click();
  expect((await replay).postDataJSON().operationKey).toBe(operationKey);
  await expect(page).toHaveURL(/\/quality\/inspections\//);
  const rows = await request.get('/api/v1/quality/inspections', {
    headers: headers(),
    params: { search: prefix + ' Reprise' },
  });
  expect((await rows.json()).total).toBe(1);
});
test('SAV source navigation opens the actual case and mobile inspection fits', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/v1/quality/inspections', {
    headers: headers(),
    data: {
      planId: plan.id,
      title: prefix + ' SAV inspection',
      sourceKind: 'SUPPORT',
      sourceId: support.id,
      operationKey: randomUUID(),
    },
  });
  expect(response.ok()).toBeTruthy();
  const r = await response.json();
  await login(page);
  await page.goto(`/quality/inspections/${r.id}`);
  await page.getByRole('link', { name: /Ouvrir le dossier source/ }).click();
  await expect(page).toHaveURL(new RegExp('caseId=' + support.id));
  await expect(page.getByRole('dialog')).toContainText(support.number);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Fermer', exact: true })
    .last()
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/quality/inspections/${r.id}`);
  await expect(
    page.getByRole('heading', { name: prefix + ' SAV inspection', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/quality-inspection-mobile.png', fullPage: true });
});
test('documentation includes business connections and launches the six-step quality tour', async ({
  page,
  request,
}) => {
  const account = await tutorialAccount(request);
  await login(page, account.credentials);
  await page.goto('/documentation?module=quality');
  await expect(page.getByRole('article')).toContainText('Une mesure exige une unité');
  await expect(page.getByRole('article')).toContainText(
    'Qualité ne bloque ni ne libère automatiquement le stock',
  );
  await expect(page.getByRole('article')).toContainText('Contrôle de lot et libération documentée');
  await page.getByRole('button', { name: 'Lancer le tutoriel' }).click();
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Bienvenue dans Qualité');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Explorer : Plans de contrôle' }).click();
  await expect(page).toHaveURL(/\/quality\/plans$/);
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Explorer : Contrôles', exact: true }).click();
  await expect(page).toHaveURL(/\/quality$/);
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Mesurer puis constater le résultat');
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Explorer : Non-conformités' }).click();
  await expect(page).toHaveURL(/\/quality\/nonconformities$/);
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Terminer', exact: true }).click();
  await expect(tour).toHaveCount(0);
});

test('first quality visit starts automatically and persists completion through the API', async ({
  page,
  request,
}) => {
  const account = await tutorialAccount(request);
  await login(page, account.credentials);
  let started = false;
  await page.route('**/api/v1/me/preferences', async (route) => {
    if (route.request().method() !== 'GET') {
      if (route.request().postDataJSON()?.moduleTour?.moduleKey === 'quality') started = true;
      return route.continue();
    }
    const response = await route.fetch();
    const preferences = await response.json();
    if (!started) delete preferences.moduleTours?.quality;
    await route.fulfill({ response, json: preferences });
  });
  await page.goto('/quality');
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Bienvenue dans Qualité');
  for (let step = 0; step < 5; step++)
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await tour.getByRole('button', { name: 'Terminer', exact: true }).click();
  await expect(tour).toHaveCount(0);
  const prefs = await request.get('/api/v1/me/preferences', { headers: account.headers });
  expect((await prefs.json()).moduleTours.quality).toMatchObject({
    version: 2,
    step: 5,
    status: 'COMPLETED',
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Qualité', exact: true })).toBeVisible();
  await expect(tour).toHaveCount(0);
});

test('assigns a due date and resumes a lost evidence upload without duplication', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const createResponse = await request.post('/api/v1/quality/inspections', {
    headers: headers(),
    data: {
      planId: plan.id,
      title: prefix + ' Justificatifs',
      sourceKind: 'MANUAL',
      operationKey: randomUUID(),
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  let r = await createResponse.json();
  const change = async (status: string) => {
    const response = await request.post(`/api/v1/quality/inspections/${r.id}/transition`, {
      headers: headers(),
      data: { expectedUpdatedAt: r.updatedAt, status, note: 'Vérifié UI' },
    });
    expect(response.ok()).toBeTruthy();
    r = await response.json();
  };
  await change('IN_PROGRESS');
  const measured = await request.patch(`/api/v1/quality/inspections/${r.id}/results`, {
    headers: headers(),
    data: {
      expectedUpdatedAt: r.updatedAt,
      results: [
        { key: 'aspect', value: 'FAIL' },
        { key: 'diameter', value: 11 },
      ],
    },
  });
  expect(measured.ok()).toBeTruthy();
  r = await measured.json();
  await change('COMPLETED');
  await login(page);
  await page.goto(`/quality/nonconformities/${r.nonconformity.id}`);
  await page.getByLabel('Échéance', { exact: true }).fill('2033-12-01');
  await page.getByRole('button', { name: 'Enregistrer le suivi', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Enregistrer le suivi', exact: true }),
  ).toBeDisabled();
  const proof = {
    name: 'controle.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nUI quality proof\n%%EOF'),
  };
  await page.getByLabel('Description de la preuve').fill('Mesure après réparation');
  await page.getByLabel('Fichier justificatif').setInputFiles(proof);
  await page.route(
    `**/api/v1/quality/nonconformities/${r.nonconformity.id}/evidence`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Ajouter le justificatif', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Reprendre la même demande', exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel('Échéance', { exact: true })).toHaveValue('2033-12-01');
  await page.getByLabel('Fichier justificatif').setInputFiles(proof);
  await page.getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Télécharger', exact: true })).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('controle.pdf');
  await page.screenshot({ path: 'test-results/quality-followup-desktop.png', fullPage: true });
  const response = await request.get(
    `/api/v1/quality/nonconformities/${r.nonconformity.id}/evidence`,
    { headers: headers() },
  );
  expect(await response.json()).toHaveLength(1);
});
