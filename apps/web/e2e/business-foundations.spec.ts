import { test, expect, type Page, type APIRequestContext } from './fixtures';
import { login, DEMO_USER, tutorialAccount } from './helpers';
import { TOUR_MODULE_KEYS } from '@pulsar/shared';
import { MODULE_LESSONS } from '../src/lib/help/module-lessons';
import { randomUUID } from 'node:crypto';
let token: string, partner: any, item: any, currentUser: any;
let pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  expect(pageErrors).toEqual([]);
});
const prefix = `UI-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
test.beforeAll(async ({ request }) => {
  const auth = await request.post('/api/v1/auth/login', { data: DEMO_USER });
  expect(auth.ok()).toBeTruthy();
  const session = await auth.json();
  token = session.accessToken;
  currentUser = session.user;
  const headers = { Authorization: `Bearer ${token}` };
  for (const key of ['catalog', 'purchasing', 'services', 'wms', 'support'])
    expect(
      (await request.patch(`/api/v1/modules/${key}`, { headers, data: { enabled: true } })).ok(),
    ).toBeTruthy();
  const p = await request.post('/api/v1/catalog/partners', {
    headers,
    data: { code: prefix, name: prefix + ' Client', isCustomer: true, isSupplier: true },
  });
  expect(p.ok()).toBeTruthy();
  partner = await p.json();
  const i = await request.post('/api/v1/catalog/items', {
    headers,
    data: { code: prefix, name: prefix + ' Prestation', kind: 'SERVICE', unit: 'H' },
  });
  expect(i.ok()).toBeTruthy();
  item = await i.json();
});
async function pick(page: Page, label: string, name: string) {
  await page
    .getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' :') })
    .click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByPlaceholder('Rechercher par nom…').fill(name);
  await dialog.getByRole('option').filter({ hasText: name }).click();
}
test('documentation is searchable, linked and can replay a module tutorial', async ({
  page,
  request,
}) => {
  const account = await tutorialAccount(request);
  await login(page, account.credentials);
  await page.goto('/documentation');
  await expect(
    page.getByRole('heading', { name: 'Documentation', exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Rechercher dans la documentation' })
    .fill('compte rendu');
  await page
    .getByRole('navigation', { name: 'Guides des applications' })
    .getByRole('link', { name: 'Services', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Règles métier' })).toBeVisible();
  await expect(page.getByRole('article')).toContainText('Terminer exige un compte rendu non vide');
  await page.getByRole('button', { name: 'Lancer le tutoriel' }).click();
  await expect(page).toHaveURL(/\/services$/);
  await expect(page.getByTestId('module-tour')).toContainText('Bienvenue dans Services');
});
test('catalogue creates, edits and deactivates a partner', async ({ page }) => {
  await login(page);
  await page.goto('/catalog/partners');
  await page.getByRole('button', { name: 'Nouveau partenaire', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code', { exact: true }).fill(prefix + '-EDIT');
  await dialog.getByLabel('Nom', { exact: true }).fill(prefix + ' Nouveau');
  await dialog.getByLabel('Fournisseur', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Rechercher dans le catalogue' })
    .fill(prefix + ' Nouveau');
  await page.getByRole('button', { name: 'Modifier ' + prefix + ' Nouveau', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('Nom', { exact: true })
    .fill(prefix + ' Modifié');
  await page.getByRole('dialog').getByLabel('Fiche active pour les nouveaux dossiers').uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Rechercher dans le catalogue' })
    .fill(prefix + ' Modifié');
  await page.getByRole('combobox', { name: 'Filtrer par activation' }).selectOption('false');
  await expect(page.getByRole('cell', { name: prefix + ' Modifié', exact: true })).toBeVisible();
});
test('project and intervention workflow persists a report and closes the project', async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page.goto('/services');
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  await page.getByLabel('Titre du projet').fill(prefix + ' Installation');
  await pick(page, 'Client', partner.name);
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page).toHaveURL(/\/services\/projects\//);
  await page.getByRole('button', { name: 'Activer le projet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await page.getByRole('button', { name: 'Nouvelle intervention', exact: true }).click();
  await page.getByLabel('Titre de l’intervention').fill(prefix + ' Visite');
  await page.getByLabel('Équipe ou responsable').fill('Équipe test');
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: prefix + ' Visite', exact: true }) })
    .click();
  await page.getByRole('button', { name: 'Démarrer', exact: true }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: prefix + ' Visite', exact: true }) })
    .click();
  await page.getByRole('button', { name: 'Terminer avec un rapport' }).click();
  const confirm = page.getByRole('dialog').last();
  await expect(confirm.getByRole('button', { name: 'Confirmer', exact: true })).toBeDisabled();
  await confirm
    .getByLabel('Compte rendu obligatoire')
    .fill('Installation vérifiée et remise au client.');
  await confirm.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Terminer le projet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Nouvelle intervention', exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: prefix + ' Installation', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Terminer le projet' })).toHaveCount(0);
});
test('supplier order confirms a persisted draft and becomes read-only', async ({ page }) => {
  test.setTimeout(60000);
  await login(page);
  await page.goto('/purchasing');
  await page.getByRole('button', { name: 'Nouvelle commande', exact: true }).click();
  await pick(page, 'Fournisseur', partner.name);
  await pick(page, 'Article de la ligne 1', item.name);
  await page.getByLabel('Quantité 1', { exact: true }).fill('2.5');
  await page.getByLabel('Prix unitaire 1', { exact: true }).fill('19.95');
  await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
  await expect(page.getByText('Total enregistré : 49.88 CAD HT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmer la commande' }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Enregistrer le brouillon' })).toHaveCount(0);
  await expect(page.getByLabel('Quantité 1', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Clôturer le suivi' }).click();
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  await expect(page.getByRole('dialog').first()).toContainText('Clôturée');
});
test('new apps remain usable on a narrow screen and in the dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.route('**/api/v1/me/preferences', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      json: {
        appearance: { theme: 'dark' },
        moduleTours: Object.fromEntries(
          TOUR_MODULE_KEYS.map((k) => [k, { version: 1, step: 4, status: 'COMPLETED' }]),
        ),
        deskLayout: {},
      },
    });
  });
  await page.goto('/documentation');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('combobox', { name: 'Guide à consulter' }).selectOption('services');
  await expect(page.getByRole('article', { name: 'Guide Services', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Guides des applications' })).toBeHidden();
  for (const path of [
    '/documentation?module=services',
    '/catalog',
    '/purchasing',
    '/services/time',
    '/services',
  ]) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
        message: `No page overflow at ${path}`,
      })
      .toBe(true);
    const profile = await page
      .getByRole('button', { name: 'Profil utilisateur', exact: true })
      .boundingBox();
    expect(profile!.x + profile!.width).toBeLessThanOrEqual(390);
  }
  await page.getByRole('button', { name: 'Nouveau projet', exact: true }).click();
  await expect(page.getByLabel('Titre du projet')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Enregistrer', exact: true }),
  ).toBeVisible();
});
for (const [key, path, label] of [
  ['documentation', '/documentation', 'Documentation'],
  ['catalog', '/catalog', 'Catalogue'],
  ['purchasing', '/purchasing', 'Achats fournisseurs'],
  ['services', '/services', 'Services'],
  ['support', '/support', 'SAV'],
]) {
  test(`first visit tutorial for ${key}`, async ({ page }) => {
    await login(page);
    const tours = Object.fromEntries(
      TOUR_MODULE_KEYS.filter((k) => k !== key).map((k) => [
        k,
        { version: 1, step: 4, status: 'COMPLETED' },
      ]),
    );
    await page.route('**/api/v1/me/preferences', async (route) => {
      if (route.request().method() === 'PUT') {
        const m = route.request().postDataJSON().moduleTour;
        if (m) tours[m.moduleKey] = m;
      }
      return route.fulfill({ json: { moduleTours: tours, appearance: {}, deskLayout: {} } });
    });
    await page.goto(path);
    const tour = page.getByTestId('module-tour');
    const lessons = MODULE_LESSONS[key];
    const count = lessons?.length ?? 5;
    await expect(tour).toContainText(
      key === 'catalog'
        ? 'Distinguer produit et prestation'
        : 'Bienvenue dans ' + (key === 'support' ? 'le SAV' : label),
    );
    for (let step = 0; step < count; step++) {
      await expect(tour).toContainText(`Étape ${step + 1} sur ${count}`);
      if (lessons) await expect(tour.getByRole('heading')).toHaveText(lessons[step].title);
      if (key === 'services' && lessons[step].title === 'Faire approuver le travail') {
        await tour.getByRole('button', { name: 'Explorer : Feuilles de temps' }).click();
        await expect(page).toHaveURL(/\/services\/time$/);
        await expect(tour).toContainText('Faire approuver le travail');
      }
      if (step < count - 1)
        await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
    }
    await tour.getByRole('button', { name: 'Terminer', exact: true }).click();
    await expect(tour).toHaveCount(0);
    await page.reload();
    await expect(tour).toHaveCount(0);
  });
}

async function newTimeJob(request: APIRequestContext, assigneeUserId = currentUser.id) {
  const headers = { Authorization: `Bearer ${token}` };
  let response = await request.post('/api/v1/services/projects', {
    headers,
    data: { partnerId: partner.id, title: prefix + ' Temps' },
  });
  expect(response.ok()).toBeTruthy();
  let p = await response.json();
  response = await request.post(`/api/v1/services/projects/${p.id}/transition`, {
    headers,
    data: { status: 'ACTIVE', expectedUpdatedAt: p.updatedAt },
  });
  expect(response.ok()).toBeTruthy();
  p = await response.json();
  response = await request.post('/api/v1/services/jobs', {
    headers,
    data: { projectId: p.id, title: prefix + ' Travail', assigneeUserId },
  });
  expect(response.ok()).toBeTruthy();
  let j = await response.json();
  response = await request.post(`/api/v1/services/jobs/${j.id}/transition`, {
    headers,
    data: { status: 'IN_PROGRESS', expectedUpdatedAt: j.updatedAt },
  });
  expect(response.ok()).toBeTruthy();
  j = await response.json();
  return { p, j, headers };
}
test('assigned work records, corrects and voids time with live project totals', async ({
  page,
  request,
}) => {
  const { p, j } = await newTimeJob(request);
  await login(page);
  await page.goto(`/services/projects/${p.id}`);
  await page.getByRole('combobox', { name: 'Affectation', exact: true }).selectOption('mine');
  await page
    .getByRole('button')
    .filter({ has: page.getByRole('heading', { name: j.title, exact: true }) })
    .click();
  await expect(page.getByRole('button', { name: /Intervenant affecté :/ })).toContainText(
    currentUser.firstName,
  );
  await page.getByRole('button', { name: 'Temps de travail', exact: true }).click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: 'Saisir du temps', exact: true }).click();
  await panel.getByLabel('Durée (minutes)', { exact: true }).fill('90');
  await panel
    .getByLabel('Travail effectué', { exact: true })
    .fill('Inspection sur site et essais.');
  await panel.getByLabel('Temps déclaré facturable', { exact: true }).check();
  await panel.getByRole('button', { name: 'Enregistrer le temps', exact: true }).click();
  await expect(panel.getByTestId('time-total')).toHaveText('1 h 30');
  await panel.getByRole('button', { name: 'Corriger', exact: true }).click();
  await panel.getByLabel('Durée (minutes)', { exact: true }).fill('120');
  await panel.getByRole('button', { name: 'Enregistrer le temps', exact: true }).click();
  await expect(panel.getByTestId('time-total')).toHaveText('2 h 00');
  await panel.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('time-total')).toHaveText('2 h 00');
  await page.getByRole('button', { name: 'Annuler le temps', exact: true }).click();
  await page.getByLabel('Motif obligatoire').fill('Essai de recette terminé.');
  await page.getByRole('button', { name: 'Confirmer l’annulation', exact: true }).click();
  await expect(page.getByTestId('time-total')).toHaveText('0 h 00');
  await expect(page.getByText('Essai de recette terminé.', { exact: false })).toBeVisible();
});
test('owner submits and withdraws time without self-approval', async ({ page, request }) => {
  const { j, headers } = await newTimeJob(request);
  expect(
    (
      await request.post('/api/v1/services/time-entries', {
        headers,
        data: {
          jobId: j.id,
          userId: currentUser.id,
          workDate: '2026-09-16',
          minutes: 15,
          billable: false,
          note: 'Revue personnelle UI',
          operationKey: randomUUID(),
        },
      })
    ).ok(),
  ).toBeTruthy();
  await login(page);
  await page.goto(`/services/interventions?jobId=${j.id}`);
  await page.getByRole('button', { name: 'Soumettre', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer : Soumettre', exact: true }).click();
  await expect(page.getByTestId('time-submitted')).toHaveText('0 h 15');
  await expect(page.getByRole('button', { name: 'Approuver', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Corriger', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Une autre personne habilitée doit approuver', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retirer la soumission', exact: true }).click();
  await page
    .getByRole('button', { name: 'Confirmer : Retirer la soumission', exact: true })
    .click();
  await expect(page.getByTestId('time-submitted')).toHaveText('0 h 00');
  await expect(page.getByRole('button', { name: 'Corriger', exact: true })).toBeVisible();
});

test('reviewer requests correction, approves once after a lost response and reopens with history', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const headers = { Authorization: `Bearer ${token}` };
  const key = 'time-' + randomUUID();
  let r = await request.post('/api/v1/roles', {
    headers,
    data: { key, name: 'Recette temps', permissionKeys: ['services.read', 'services.time.write'] },
  });
  expect(r.ok()).toBeTruthy();
  const role = await r.json();
  const email = `${key}@example.test`;
  r = await request.post('/api/v1/users', {
    headers,
    data: {
      email,
      password: 'Ui-Review-2026!',
      firstName: 'Camille',
      lastName: 'Recette',
      roleIds: [role.id],
    },
  });
  expect(r.ok()).toBeTruthy();
  const worker = await r.json();
  r = await request.post('/api/v1/auth/login', {
    data: { tenant: 'acme', email, password: 'Ui-Review-2026!' },
  });
  expect(r.ok()).toBeTruthy();
  const workerHeaders = { Authorization: `Bearer ${(await r.json()).accessToken}` };
  const { p, j } = await newTimeJob(request, worker.id);
  r = await request.post('/api/v1/services/time-entries', {
    headers: workerHeaders,
    data: {
      jobId: j.id,
      userId: worker.id,
      workDate: '2026-09-16',
      minutes: 40,
      billable: true,
      note: 'Essais de mise en service',
      operationKey: randomUUID(),
    },
  });
  expect(r.ok()).toBeTruthy();
  let entry = await r.json();
  r = await request.post(`/api/v1/services/time-entries/${entry.id}/review`, {
    headers: workerHeaders,
    data: { action: 'SUBMIT', expectedUpdatedAt: entry.updatedAt },
  });
  expect(r.ok()).toBeTruthy();
  await login(page);
  await page.goto(`/services/projects/${p.id}`);
  await page.getByRole('button', { name: 'Voir les temps à approuver', exact: true }).click();
  await page.getByRole('button', { name: 'Demander une correction', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Confirmer : Demander une correction', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Motif obligatoire').fill('Inclure les essais finaux.');
  await page
    .getByRole('button', { name: 'Confirmer : Demander une correction', exact: true })
    .click();
  await expect(page.getByTestId('time-submitted')).toHaveText('0 h 00');
  await page.getByRole('combobox', { name: 'État des temps', exact: true }).selectOption('');
  await expect(page.getByText('Dernier motif : Inclure les essais finaux.')).toBeVisible();
  entry = (
    await (
      await request.get(`/api/v1/services/time-entries?jobId=${j.id}`, { headers: workerHeaders })
    ).json()
  ).items[0];
  r = await request.patch(`/api/v1/services/time-entries/${entry.id}`, {
    headers: workerHeaders,
    data: {
      expectedUpdatedAt: entry.updatedAt,
      workDate: '2026-09-16',
      minutes: 55,
      billable: true,
      note: 'Essais finaux inclus',
    },
  });
  expect(r.ok()).toBeTruthy();
  entry = await r.json();
  expect(
    (
      await request.post(`/api/v1/services/time-entries/${entry.id}/review`, {
        headers: workerHeaders,
        data: { action: 'SUBMIT', expectedUpdatedAt: entry.updatedAt },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await page.route(`**/api/v1/services/time-entries/${entry.id}/review`, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Approuver', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmer : Approuver', exact: true }).click();
  await expect(page.getByText('Résultat incertain.', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirmer : Approuver', exact: true }),
  ).toBeDisabled();
  await page.unroute(`**/api/v1/services/time-entries/${entry.id}/review`);
  await page.getByRole('button', { name: 'Retour', exact: true }).click();
  await expect(page.getByTestId('time-approved')).toHaveText('0 h 55');
  await page.getByRole('button', { name: 'Rouvrir pour correction', exact: true }).click();
  await page.getByLabel('Motif obligatoire').fill('Vérification supplémentaire demandée.');
  await page
    .getByRole('button', { name: 'Confirmer : Rouvrir pour correction', exact: true })
    .click();
  await expect(page.getByTestId('time-approved')).toHaveText('0 h 00');
  await page.getByRole('button', { name: 'Historique (6)', exact: true }).click();
  const history = page.getByRole('dialog');
  await expect(history).toContainText('Vérification supplémentaire demandée.');
  await expect(history).toContainText('Inclure les essais finaux.');
  const saved = await (
    await request.get(`/api/v1/services/time-entries/${entry.id}/reviews`, { headers })
  ).json();
  expect(saved.items.filter((e: any) => e.action === 'APPROVE')).toHaveLength(1);
  expect(saved.total).toBe(6);
});

test('documentation explains connections, future boundaries, search and mobile reading', async ({
  page,
}) => {
  await login(page);
  await page.goto('/documentation?view=connections');
  const guide = page.getByRole('article', { name: 'Guide des liens entre modules' });
  await expect(
    guide.getByRole('heading', { name: 'Liens entre modules', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Rechercher dans la documentation' })
    .fill('retour intégral');
  await expect(
    guide.getByRole('heading', { name: 'Pièces utilisées et retour physique' }),
  ).toBeVisible();
  await expect(guide).toContainText('Le disponible affiché n’est pas réservé');
  await page.getByRole('textbox', { name: 'Rechercher dans la documentation' }).fill('facturation');
  await expect(
    guide.getByRole('region', { name: 'Heures et pièces vers la facturation' }),
  ).toContainText('Action métier disponible');
  await page
    .getByRole('textbox', { name: 'Rechercher dans la documentation' })
    .fill('aucune-connexion-zzzz');
  await expect(guide).toContainText('Aucune fiche de connexion');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/documentation?module=services');
  await page
    .getByRole('navigation', { name: 'Sommaire du guide' })
    .getByRole('link', { name: 'Connexions', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Connexions avec les autres applications' }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('catalogue stock mapping, lost response recovery and successive partial returns', async ({
  page,
  request,
}) => {
  const { j, headers } = await newTimeJob(request);
  async function create(path: string, data: object) {
    const response = await request.post(`/api/v1/${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const code = `${prefix}-PART`;
  const product = await create('catalog/items', {
    code,
    name: code + ' Joint terrain',
    kind: 'GOODS',
    unit: 'EA',
  });
  const stock = await create('wms/items', {
    sku: code,
    name: code + ' Article physique',
    unit: 'EA',
  });
  const location = await create('locations', {
    code,
    name: code + ' Atelier',
    type: 'WAREHOUSE',
    addressLine1: '10 rue des Essais',
    city: 'Québec',
    state: 'QC',
    country: 'CA',
  });
  const bin = await create('wms/bins', { locationId: location.id, code: 'R-01', kind: 'STORAGE' });
  await request.post('/api/v1/wms/inventory/adjust', {
    headers,
    data: { itemId: stock.id, binId: bin.id, qtyDelta: 5, note: 'Fixture recette' },
  });
  await login(page);
  await page.goto('/catalog');
  await page.getByRole('textbox', { name: 'Rechercher dans le catalogue' }).fill(code);
  await page.getByRole('button', { name: `Stock WMS de ${product.name}` }).click();
  await pick(page, 'Article WMS', stock.name);
  await page.getByRole('button', { name: 'Enregistrer la correspondance' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`/services/interventions?jobId=${j.id}&section=parts`);
  await page.getByRole('button', { name: 'Consommer une pièce', exact: true }).click();
  await pick(page, 'Produit du Catalogue', product.name);
  await pick(page, 'Emplacement source', location.name);
  await page.getByLabel('Quantité consommée').fill('2');
  await page.getByLabel('Utilisation des pièces').fill('Pose du joint lors de la visite');
  const submit = page.getByRole('button', { name: 'Confirmer la sortie de stock' });
  await expect(submit).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'Je confirme le mouvement physique et la quantité.' })
    .check();
  let lost = false;
  await page.route(`**/api/v1/services/jobs/${j.id}/parts`, async (route) => {
    if (route.request().method() === 'POST' && !lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort('failed');
    } else await route.continue();
  });
  await submit.click();
  await expect(
    page.getByRole('button', { name: 'Vérifier / reprendre l’opération' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Vérifier / reprendre l’opération' }).click();
  await expect(page.getByRole('button', { name: 'Vérifier / reprendre l’opération' })).toHaveCount(
    0,
  );
  const getStock = async () => {
    const r = await request.get(`/api/v1/wms/inventory?itemId=${stock.id}&binId=${bin.id}`, {
      headers,
    });
    return Number((await r.json())[0].qtyOnHand);
  };
  expect(await getStock()).toBe(3);
  await expect(page.getByRole('article', { name: `Pièce ${code}` })).toHaveCount(1);
  await page.getByRole('button', { name: 'Retourner une quantité' }).click();
  await page.getByLabel('Quantité retournée (EA)').fill('0.375');
  await page.getByLabel('Motif du retour').fill('Pièces revenues physiquement au rangement');
  await page
    .getByRole('checkbox', { name: 'Je confirme le mouvement physique et la quantité.' })
    .check();
  let lostReturn = false;
  await page.route(`**/api/v1/services/jobs/${j.id}/parts/*/return`, async (route) => {
    if (!lostReturn) {
      lostReturn = true;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Confirmer le retour de stock' }).click();
  await expect(
    page.getByRole('button', { name: 'Vérifier / reprendre l’opération' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Vérifier / reprendre l’opération' }).click();
  await expect(page.getByRole('button', { name: 'Vérifier / reprendre l’opération' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('article', { name: `Pièce ${code}` })).toContainText(
    'Retour partiel',
  );
  await page
    .getByRole('article', { name: `Pièce ${code}` })
    .screenshot({ path: test.info().outputPath('partial-return-desktop.png') });
  expect(await getStock()).toBe(3.375);
  await page.getByRole('button', { name: 'Retourner une quantité' }).click();
  await expect(page.getByLabel('Quantité retournée (EA)')).toHaveValue('1.625');
  await page.getByLabel('Motif du retour').fill('Solde revenu après contrôle');
  await page
    .getByRole('checkbox', { name: 'Je confirme le mouvement physique et la quantité.' })
    .check();
  await page.getByRole('button', { name: 'Confirmer le retour de stock' }).click();
  await expect(page.getByRole('article', { name: `Pièce ${code}` })).toContainText(
    'Retourné intégralement',
  );
  expect(await getStock()).toBe(5);
  const entries = await request.get(`/api/v1/services/jobs/${j.id}/parts`, { headers });
  const parts = (await entries.json()).items;
  expect(parts).toHaveLength(1);
  expect(parts[0].remainingQuantity).toBe('0');
  expect(parts[0].returns).toHaveLength(2);
  expect(parts[0].returnCount).toBe(2);
  expect(parts[0].returns.every((entry: any) => entry.movementId !== parts[0].movementId)).toBe(
    true,
  );
  await page.getByText('Historique des retours (2)', { exact: true }).click();
  await expect(page.getByText('Solde revenu après contrôle', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('article', { name: `Pièce ${code}` })
    .screenshot({ path: test.info().outputPath('partial-return-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Ouvrir le journal WMS de cette intervention' }).click();
  await expect(page).toHaveURL(new RegExp(`/wms/movements\\?refType=service-job&refId=${j.id}`));
  await expect(page.getByRole('link', { name: `${j.number} ↗` })).toHaveCount(3);
  await page
    .getByRole('link', { name: `${j.number} ↗` })
    .first()
    .click();
  await expect(page.getByRole('article', { name: `Pièce ${code}` })).toContainText(
    'Retourné intégralement',
  );
});

test('customer credit recovers a lost response, updates the balance and authorizes a separate physical return', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const { p, j, headers } = await newTimeJob(request);
  const create = async (path: string, data: object) => {
    const r = await request.post('/api/v1/' + path, { headers, data });
    const text = await r.text();
    expect(r.ok(), text).toBeTruthy();
    return text ? JSON.parse(text) : {};
  };
  const code = prefix + '-CREDIT';
  const product = await create('catalog/items', {
    code,
    name: code + ' Pièce',
    kind: 'GOODS',
    unit: 'EA',
  });
  const stock = await create('wms/items', { sku: code, name: code + ' Stock', unit: 'EA' });
  const location = await create('locations', {
    code,
    name: code + ' Atelier',
    type: 'WAREHOUSE',
    addressLine1: '10 rue des Essais',
    city: 'Québec',
    state: 'QC',
    country: 'CA',
  });
  const bin = await create('wms/bins', { locationId: location.id, code: 'AV-01', kind: 'STORAGE' });
  await create('wms/inventory/adjust', {
    itemId: stock.id,
    binId: bin.id,
    qtyDelta: 5,
    note: 'Recette avoir',
  });
  expect(
    (
      await request.patch(`/api/v1/catalog/items/${product.id}/stock-link`, {
        headers,
        data: { wmsItemId: stock.id, expectedUpdatedAt: product.updatedAt },
      })
    ).ok(),
  ).toBeTruthy();
  await create(`services/jobs/${j.id}/parts`, {
    catalogItemId: product.id,
    binId: bin.id,
    quantity: 2,
    note: 'Pièces installées',
    expectedUpdatedAt: j.updatedAt,
    operationKey: randomUUID(),
  });
  const partnerRead = await request.get(`/api/v1/catalog/partners/${partner.id}/links`, {
    headers,
  });
  expect(partnerRead.ok()).toBeTruthy();
  const partnerState = await partnerRead.json();
  if (!partnerState.billingCustomerId)
    await create(`catalog/partners/${partner.id}/billing-customer`, {
      expectedUpdatedAt: partnerState.updatedAt,
    });
  const billable = await (
    await request.get(`/api/v1/services/projects/${p.id}/billable`, { headers })
  ).json();
  const invoice = await create(`services/projects/${p.id}/invoice`, {
    operationKey: randomUUID(),
    currency: 'CAD',
    sources: billable.sources.map((s: any) => ({
      kind: s.kind,
      id: s.id,
      unitPrice: 10,
      expectedVersion: s.expectedVersion,
    })),
  });
  await create(`billing/customer-invoices/${invoice.invoiceId}/approve`, {});
  await login(page);
  await page.goto(`/invoices?statement=${invoice.invoiceId}`);
  const panel = page.getByRole('region', { name: 'Avoirs et solde client' });
  await expect(panel).toBeVisible();
  await panel.getByText('Préparer un avoir', { exact: true }).click();
  await panel.getByRole('spinbutton').fill('1');
  await panel.getByLabel('Motif de l’avoir').fill('Une pièce retournée par le client');
  let lost = false;
  await page.route(
    `**/api/v1/billing/customer-invoices/${invoice.invoiceId}/credits`,
    async (route) => {
      if (route.request().method() === 'POST' && !lost) {
        lost = true;
        const r = await route.fetch();
        expect(r.ok(), await r.text()).toBeTruthy();
        await route.abort('failed');
      } else await route.continue();
    },
  );
  await panel.getByRole('button', { name: 'Calculer le brouillon d’avoir' }).click();
  await expect(
    panel.getByRole('button', { name: 'Vérifier / reprendre le brouillon d’avoir' }),
  ).toBeVisible();
  await page.reload();
  await panel.getByRole('button', { name: 'Vérifier / reprendre le brouillon d’avoir' }).click();
  await expect(panel.getByRole('article')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Valider l’avoir', exact: true }).click();
  await expect(panel).toContainText('Aucune sortie d’argent ni entrée de stock automatique');
  await panel.getByRole('button', { name: 'Confirmer la validation de l’avoir' }).click();
  await expect(panel.getByRole('article')).toContainText('Validé');
  const context = await (
    await request.get(`/api/v1/billing/customer-invoices/${invoice.invoiceId}/credits`, { headers })
  ).json();
  expect(context).toMatchObject({
    totalAmount: '20',
    amountPaid: '0',
    creditedAmount: '10',
    outstanding: 10,
  });
  expect(context.notes).toHaveLength(1);
  await panel.getByText('Document et envoi client', { exact: true }).click();
  await panel
    .getByLabel('Nom légal de l’émetteur', { exact: true })
    .fill('Atelier Démonstration inc.');
  await panel
    .getByLabel('Adresse de l’émetteur', { exact: true })
    .fill('123, rue de l’Érable\nQuébec (Québec) G1A 1A1');
  await panel
    .getByLabel('Inscriptions fiscales (libellés et numéros)', { exact: true })
    .fill('Démonstration sans valeur comptable');
  await panel.getByLabel('Nom légal du client', { exact: true }).fill('Client de recette');
  await panel
    .getByRole('checkbox', {
      name: 'Je confirme les coordonnées et les mentions fiscales; elles seront définitives.',
    })
    .check();
  let publicationLost = false;
  await page.route(
    `**/api/v1/billing/customer-invoices/${invoice.invoiceId}/credits/${context.notes[0].id}/document`,
    async (route) => {
      if (route.request().method() === 'POST' && !publicationLost) {
        publicationLost = true;
        const response = await route.fetch();
        expect(response.ok(), await response.text()).toBeTruthy();
        await route.abort('failed');
      } else await route.continue();
    },
  );
  await panel.getByRole('button', { name: 'Figer et générer le PDF' }).click();
  await expect(panel).toContainText('Actualisez pour vérifier si les coordonnées');
  await panel.getByRole('button', { name: 'Actualiser le document et l’envoi' }).click();
  await expect(panel).toContainText('PDF figé');
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Télécharger le PDF d’avoir' }).click();
  const download = await downloadPromise;
  await download.saveAs(test.info().outputPath('credit-note.pdf'));
  // Fail before any send if the environment is configured for real SMTP.
  await expect(panel).toContainText('Mode simulation');
  await panel.getByLabel('Courriel du destinataire', { exact: true }).fill('client@example.test');
  await panel
    .getByRole('checkbox', { name: 'Je confirme la simulation, sans envoi externe.' })
    .check();
  await panel.getByRole('button', { name: 'Simuler l’envoi de l’avoir' }).click();
  await expect(async () => {
    await panel.getByRole('button', { name: 'Actualiser le document et l’envoi' }).click();
    await expect(panel).toContainText('Simulation locale terminée · aucun courriel envoyé');
  }).toPass();
  await expect(panel.getByRole('button', { name: 'Simuler l’envoi de l’avoir' })).toHaveCount(0);
  await panel.screenshot({ path: test.info().outputPath('credit-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({ path: test.info().outputPath('credit-mobile.png') });
  await panel.getByRole('button', { name: 'Télécharger le PDF d’avoir' }).scrollIntoViewIfNeeded();
  await expect(panel.getByText('Simulation locale terminée · aucun courriel envoyé')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('credit-mobile-document.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const getStock = async () =>
    Number(
      (
        await (
          await request.get(`/api/v1/wms/inventory?itemId=${stock.id}&binId=${bin.id}`, { headers })
        ).json()
      )[0].qtyOnHand,
    );
  expect(await getStock()).toBe(3);
  await page.goto(`/services/interventions?jobId=${j.id}&section=parts`);
  await page.getByRole('button', { name: 'Retourner une quantité' }).click();
  await expect(page.getByLabel('Quantité retournée (EA)')).toHaveValue('1');
  await expect(page.getByLabel('Avoir validé autorisant ce retour')).toBeVisible();
  await page.getByLabel('Motif du retour').fill('Pièce physiquement reçue');
  await page
    .getByRole('checkbox', { name: 'Je confirme le mouvement physique et la quantité.' })
    .check();
  await page.getByRole('button', { name: 'Confirmer le retour de stock' }).click();
  await expect(page.getByRole('article', { name: `Pièce ${code}` })).toContainText(
    'Retour partiel',
  );
  expect(await getStock()).toBe(4);
  await expect(page.getByRole('button', { name: 'Retourner une quantité' })).toHaveCount(0);
});

test('supplier arrival records partial stock, recovers lost response, and preserves the remainder', async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${token}` },
    code = prefix + '-BUY';
  const create = async (path: string, data: object) => {
    const r = await request.post('/api/v1/' + path, { headers, data });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  const product = await create('catalog/items', {
    code,
    name: code + ' Joint',
    kind: 'GOODS',
    unit: 'EA',
  });
  const stock = await create('wms/items', { sku: code, name: code + ' Physique', unit: 'EA' });
  const location = await create('locations', {
    code,
    name: code + ' Entrepôt',
    type: 'WAREHOUSE',
    addressLine1: '10 rue des Essais',
    city: 'Québec',
    state: 'QC',
    country: 'CA',
  });
  const bin = await create('wms/bins', {
    locationId: location.id,
    code: 'BUY-01',
    kind: 'STORAGE',
  });
  expect(
    (
      await request.patch(`/api/v1/catalog/items/${product.id}/stock-link`, {
        headers,
        data: { wmsItemId: stock.id, expectedUpdatedAt: product.updatedAt },
      })
    ).ok(),
  ).toBeTruthy();
  let o = await create('purchasing/orders', {
    supplierId: partner.id,
    currency: 'CAD',
    lines: [{ catalogItemId: product.id, quantity: 10, unitPrice: 2 }],
  });
  o = await create(`purchasing/orders/${o.id}/transition`, {
    status: 'CONFIRMED',
    expectedUpdatedAt: o.updatedAt,
  });
  await login(page);
  await page.goto(`/purchasing/orders/${o.id}/receiving`);
  await pick(page, 'Entrepôt de réception', location.name);
  await page.getByLabel('Bon de livraison ou référence').fill('BL-UI-4');
  await page.getByLabel('Quantité reçue maintenant').fill('4');
  await pick(page, 'Emplacement pour ' + product.name, 'BUY-01');
  await page
    .getByRole('checkbox', {
      name: 'Je confirme l’arrivée physique de ces quantités aux emplacements sélectionnés.',
    })
    .check();
  let lost = false;
  await page.route(`**/api/v1/purchasing/orders/${o.id}/receipts`, async (route) => {
    if (route.request().method() === 'POST' && !lost) {
      lost = true;
      const r = await route.fetch();
      expect(r.ok(), await r.text()).toBeTruthy();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Confirmer la réception physique' }).click();
  await expect(
    page.getByRole('button', { name: 'Reprendre la réception conservée' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la réception conservée' }).click();
  await expect(page.getByRole('button', { name: 'Reprendre la réception conservée' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('region', { name: 'Quantités fournisseur' })).toContainText('6 EA');
  const fresh = await request.get(`/api/v1/purchasing/orders/${o.id}`, { headers });
  expect((await fresh.json()).lines[0]).toMatchObject({ received: '4', remaining: '6' });
  const h = await request.get(`/api/v1/purchasing/orders/${o.id}/receipts`, { headers });
  expect((await h.json()).total).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('link', { name: 'Ouvrir la réception WMS' }).click();
  await expect(page).toHaveURL(/\/wms\/receiving\//);
});

test('SAV creates once after lost response, qualifies, links an intervention and resolves with history', async ({
  page,
  request,
}) => {
  const { j } = await newTimeJob(request);
  await login(page);
  await page.goto('/support');
  await page.getByRole('button', { name: 'Nouvelle demande', exact: true }).click();
  await pick(page, 'Client SAV', partner.name);
  await page.getByLabel('Objet de la demande').fill(prefix + ' SAV');
  await page.getByLabel('Description du problème').fill('Bruit de pompe à diagnostiquer');
  let lost = false;
  await page.route('**/api/v1/support/cases', async (route) => {
    if (route.request().method() === 'POST' && !lost) {
      lost = true;
      const r = await route.fetch();
      expect(r.ok(), await r.text()).toBeTruthy();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Enregistrer la demande', exact: true }).click();
  await page.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la demande conservée' }).click();
  await expect(page.getByLabel('Objet de la demande')).toHaveValue(prefix + ' SAV');
  await pick(page, 'Intervention liée (facultatif)', j.number);
  await page.getByRole('button', { name: 'Enregistrer la demande', exact: true }).click();
  await page.getByRole('button', { name: 'En traitement', exact: true }).click();
  await page.getByLabel('Compte rendu ou motif').fill('Diagnostic en cours');
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  await page.getByRole('button', { name: 'Résolu', exact: true }).click();
  await page.getByLabel('Compte rendu ou motif').fill('Joint remplacé, essais vérifiés');
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Historique SAV' })).toContainText(
    'Joint remplacé',
  );
  await expect(page.getByRole('button', { name: 'Rouvrir', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Rechercher une demande SAV' }).fill(prefix + ' SAV');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.goto('/documentation?module=support');
  await expect(page.getByRole('heading', { name: 'SAV', exact: true })).toBeVisible();
  await page.goto('/documentation?view=roadmap');
  await expect(
    page.getByRole('article', { name: 'Programme des modules spécialisés' }),
  ).toContainText('Restauration');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('lost time response is recovered after reload without a duplicate entry', async ({
  page,
  request,
}) => {
  const { j, headers } = await newTimeJob(request);
  await login(page);
  await page.goto(`/services/interventions?jobId=${j.id}`);
  await page.getByRole('button', { name: 'Saisir du temps', exact: true }).click();
  await page.getByLabel('Durée (minutes)', { exact: true }).fill('15');
  await page
    .getByLabel('Travail effectué', { exact: true })
    .fill('Reprise de saisie après coupure.');
  let operationKey = '';
  await page.route('**/api/v1/services/time-entries', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    operationKey = route.request().postDataJSON().operationKey;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Enregistrer le temps', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vérifier et reprendre la saisie' })).toBeVisible();
  await page.getByRole('button', { name: 'Fermer la saisie' }).click();
  await page.unroute('**/api/v1/services/time-entries');
  await page.reload();
  await page.getByRole('button', { name: 'Vérifier et reprendre la saisie' }).click();
  await expect(page.getByRole('button', { name: 'Vérifier et reprendre la saisie' })).toHaveCount(
    0,
  );
  const rows = await (
    await request.get(`/api/v1/services/time-entries?jobId=${j.id}`, { headers })
  ).json();
  expect(operationKey).toBeTruthy();
  expect(rows.total).toBe(1);
  expect(rows.summary.minutes).toBe(15);
});
