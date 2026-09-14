import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

function fixture() {
  const site = {
    id: 'yard-site',
    code: 'QC',
    name: 'Distribution du Fjord',
    timezone: 'America/Toronto',
  };
  const spots = [
    { id: 'q1', code: 'Q-01', type: 'DOCK_DOOR', isActive: true, posX: 1, posY: 2 },
    { id: 'q2', code: 'Q-02', type: 'DOCK_DOOR', isActive: true, posX: 2, posY: 2 },
    { id: 'p1', code: 'P-01', type: 'PARKING', isActive: true, posX: 1, posY: 4 },
  ];
  const visit = {
    id: 'v1',
    visitNumber: 'YV-218',
    status: 'ASSIGNED',
    direction: 'INBOUND',
    spotId: 'q1' as string | null,
    appointmentId: 'a1',
    trailerRef: 'RF-218',
    trailer: null,
    carrier: { name: 'Transport du Fjord' },
    driverName: 'Alex',
    checkInAt: new Date(Date.now() - 100 * 60000).toISOString(),
  };
  const appointments = [
    {
      id: 'a1',
      appointmentNumber: 'DA-218',
      status: 'ARRIVED',
      direction: 'INBOUND',
      spotId: 'q1',
      carrierId: 'c1',
      windowStart: '2026-09-14T14:00:00Z',
      windowEnd: '2026-09-14T16:00:00Z',
      reference: 'Commande 218',
      notes: null,
      carrier: { name: 'Transport du Fjord' },
    },
    {
      id: 'a2',
      appointmentNumber: 'DA-219',
      status: 'SCHEDULED',
      direction: 'OUTBOUND',
      spotId: 'q1',
      carrierId: 'c1',
      windowStart: '2026-09-14T15:00:00Z',
      windowEnd: '2026-09-14T17:00:00Z',
      reference: 'Commande 219',
      notes: null,
      carrier: { name: 'Transport du Fjord' },
    },
  ];
  return {
    site,
    date: '2026-09-14',
    timeZone: 'America/Toronto',
    timezoneFallback: false,
    start: '2026-09-14T04:00:00Z',
    end: '2026-09-15T04:00:00Z',
    generatedAt: new Date().toISOString(),
    planVersion: 'a'.repeat(64),
    shapes: [
      { id: 'building', kind: 'BUILDING', label: 'Entrepôt nord', x: 1, y: 0, width: 5, height: 2 },
    ],
    spots,
    visits: [
      visit,
      {
        ...visit,
        id: 'v2',
        visitNumber: 'YV-219',
        trailerRef: 'RF-219',
        status: 'CHECKED_IN',
        spotId: null,
        appointmentId: null,
      },
    ],
    appointments,
    truncated: { spots: false, visits: false, appointments: false },
  };
}
async function setup(page: Page) {
  await login(page);
  const data = fixture();
  await page.route('**/api/v1/yard/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname.replace('/api/v1/yard/', '');
    if (route.request().method() !== 'GET')
      return route.fulfill({
        status: 500,
        json: { message: 'Écriture non autorisée dans ce scénario UI.' },
      });
    if (path === 'sites')
      return route.fulfill({
        json: {
          items: [
            data.site,
            { ...data.site, id: 'other-site', code: 'MTL', name: 'Site Montréal' },
          ],
          truncated: false,
        },
      });
    if (path === 'workspace')
      return route.fulfill({
        json:
          url.searchParams.get('locationId') === 'other-site'
            ? {
                ...data,
                site: { ...data.site, id: 'other-site', name: 'Site Montréal' },
                spots: [],
                visits: [],
                appointments: [],
                shapes: [],
              }
            : data,
      });
    if (path === 'custom-fields') return route.fulfill({ json: [] });
    if (path.startsWith('visits/')) {
      const v = data.visits.find((v) => v.id === path.split('/')[1]);
      return route.fulfill({
        json: {
          ...v,
          notes: null,
          checkOutAt: null,
          spot: data.spots.find((s) => s.id === v?.spotId) ?? null,
          appointment: v?.appointmentId ? { appointmentNumber: 'DA-218' } : null,
          moves: [],
        },
      });
    }
    return route.fulfill({ status: 404, json: { message: 'Route non prévue dans ce scénario.' } });
  });
  await page.goto('/yard');
  await expect(page.getByRole('heading', { name: 'Cour & quais', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quai Q-02 — libre', exact: true })).toBeVisible();
  return data;
}
test('specialized plan shows real occupancy, opens a drawer and retains the workspace width', async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByText('Entrepôt nord', { exact: true })).toBeVisible();
  const width = await page.locator('main').boundingBox();
  await page.getByRole('button', { name: 'Quai Q-01 — occupé, RF-218', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Visite YV-218', exact: true });
  await expect(panel.getByText('Transport du Fjord', { exact: true })).toBeVisible();
  expect((await page.locator('main').boundingBox())?.width).toBe(width?.width);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
test('assign from a free dock confirms, cancel sends nothing, success refreshes occupancy', async ({
  page,
}) => {
  const data = await setup(page);
  let writes = 0;
  await page.route('**/api/v1/yard/visits/v2/assign', (r) => {
    writes++;
    expect(r.request().postDataJSON()).toEqual({ spotId: 'q2' });
    data.visits[1].spotId = 'q2';
    data.visits[1].status = 'ASSIGNED';
    return r.fulfill({ json: data.visits[1] });
  });
  await page.getByRole('button', { name: 'Quai Q-02 — libre', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Emplacement Q-02', exact: true });
  await panel.getByLabel('Visite à affecter').selectOption('v2');
  await panel.getByRole('button', { name: 'Affecter à cet emplacement' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirmer l’affectation', exact: true });
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toBe(0);
  await panel.getByRole('button', { name: 'Affecter à cet emplacement' }).click();
  await confirm.getByRole('button', { name: 'Affecter', exact: true }).click();
  await expect(panel).toBeHidden();
  expect(writes).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Quai Q-02 — occupé, RF-219', exact: true }),
  ).toBeVisible();
});
test('failed movement retains selection; departure requires an explicit confirmation', async ({
  page,
}) => {
  await setup(page);
  let departures = 0;
  await page.route('**/api/v1/yard/visits/v1/move', (r) =>
    r.fulfill({ status: 409, json: { message: 'Quai pris par un autre opérateur.' } }),
  );
  await page.route('**/api/v1/yard/visits/v1/check-out', (r) => {
    departures++;
    return r.fulfill({ json: {} });
  });
  await page.getByRole('button', { name: 'Quai Q-01 — occupé, RF-218', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Visite YV-218', exact: true });
  await panel.getByLabel('Emplacement de destination').selectOption('q2');
  await panel.getByRole('button', { name: 'Déplacer', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer l’affectation', exact: true })
    .getByRole('button', { name: 'Affecter', exact: true })
    .click();
  await expect(panel.getByRole('alert')).toContainText('Quai pris');
  await expect(panel.getByLabel('Emplacement de destination')).toHaveValue('q2');
  await panel.getByRole('button', { name: 'Enregistrer le départ', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Enregistrer le départ', exact: true })
    .getByRole('button', { name: 'Annuler', exact: true })
    .click();
  expect(departures).toBe(0);
});
test('editing the drawing never moves a visit; failed save and cancelled close keep the draft', async ({
  page,
}) => {
  await setup(page);
  let saves = 0;
  await page.route('**/api/v1/yard/sites/yard-site/plan', (r) => {
    saves++;
    expect(r.request().postDataJSON().shapes.at(-1).label).toBe('Atelier');
    return r.fulfill({ status: 409, json: { message: 'Le plan a changé sur une autre session.' } });
  });
  await page.getByRole('button', { name: 'Configurer le plan' }).click();
  await page.getByRole('button', { name: '+ Bâtiment', exact: true }).click();
  await page.getByLabel('Nom', { exact: true }).fill('Atelier');
  await page.getByRole('button', { name: 'Enregistrer le plan', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('autre session');
  await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Atelier');
  await page.getByRole('button', { name: 'Abandonner', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Quitter l’édition du plan' })
    .getByRole('button', { name: 'Annuler', exact: true })
    .click();
  await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Atelier');
  expect(saves).toBe(1);
});
test('dock planning identifies conflicts and links a booking to arrival without implicit writes', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('tab', { name: 'Planning des quais', exact: true }).click();
  await expect(page.getByText('2 rendez-vous en conflit', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Rendez-vous DA-219, Q-01, Prévu, conflit horaire', exact: true })
    .click();
  const panel = page.getByRole('dialog', { name: 'Rendez-vous DA-219', exact: true });
  await expect(panel).toContainText('chevauche');
  await panel.getByRole('button', { name: 'Enregistrer l’arrivée', exact: true }).click();
  const arrival = page.getByRole('dialog', { name: 'Enregistrer une arrivée', exact: true });
  await expect(arrival).toContainText('DA-219');
  await expect(arrival.getByRole('combobox', { name: 'Opération', exact: true })).toHaveValue(
    'OUTBOUND',
  );
  await arrival.getByLabel('Remorque ou référence du véhicule').fill('RF-NEW');
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Fermer la saisie', exact: true })
    .getByRole('button', { name: 'Annuler', exact: true })
    .click();
  await expect(arrival.getByLabel('Remorque ou référence du véhicule')).toHaveValue('RF-NEW');
});
test('a failed arrival can be corrected and retried without losing its fields', async ({
  page,
}) => {
  await setup(page);
  await page.route('**/api/v1/yard/visits', (r) =>
    r.fulfill({ status: 400, json: { message: 'Chauffeur à vérifier.' } }),
  );
  await page.getByRole('button', { name: 'Enregistrer une arrivée', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Enregistrer une arrivée', exact: true });
  await panel.getByLabel('Remorque ou référence du véhicule').fill('RF-RETRY');
  await panel.getByRole('button', { name: 'Enregistrer l’arrivée', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Chauffeur à vérifier');
  await expect(panel.getByLabel('Remorque ou référence du véhicule')).toHaveValue('RF-RETRY');
  await expect(
    panel.getByRole('button', { name: 'Enregistrer l’arrivée', exact: true }),
  ).toBeEnabled();
});

test('an uncertain arrival is not replayed and keeps the operator’s input', async ({ page }) => {
  await setup(page);
  await page.route('**/api/v1/yard/visits', (r) => r.abort('failed'));
  await page.getByRole('button', { name: 'Enregistrer une arrivée', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Enregistrer une arrivée', exact: true });
  await panel.getByLabel('Remorque ou référence du véhicule').fill('RF-UNCERTAIN');
  await panel.getByRole('button', { name: 'Enregistrer l’arrivée', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('a peut-être été enregistrée');
  await expect(
    panel.getByRole('button', { name: 'Enregistrer l’arrivée', exact: true }),
  ).toBeDisabled();
  await expect(panel.getByLabel('Remorque ou référence du véhicule')).toHaveValue('RF-UNCERTAIN');
});

test('a valid drawing saves display geometry only and survives a reload', async ({ page }) => {
  const data = await setup(page);
  let saves = 0;
  await page.route('**/api/v1/yard/sites/yard-site/plan', (r) => {
    saves++;
    const body = r.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual(['expectedVersion', 'positions', 'shapes']);
    expect(body.expectedVersion).toBe(data.planVersion);
    data.shapes = body.shapes;
    return r.fulfill({ json: { saved: true } });
  });
  await page.getByRole('button', { name: 'Configurer le plan' }).click();
  await page.getByRole('button', { name: '+ Bâtiment', exact: true }).click();
  await page.getByLabel('Nom', { exact: true }).fill('Atelier mécanique');
  await page.getByRole('button', { name: 'Enregistrer le plan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Configurer le plan' })).toBeVisible();
  await expect(page.getByText('Atelier mécanique', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Quai Q-01 — occupé, RF-218', exact: true }),
  ).toBeVisible();
  expect(saves).toBe(1);
  await page.reload();
  await expect(page.getByText('Atelier mécanique', { exact: true })).toBeVisible();
});

test('historical bookings on parking spots remain visible in the schedule', async ({ page }) => {
  const data = await setup(page);
  data.appointments[1].spotId = 'p1';
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await page.getByRole('tab', { name: 'Planning des quais', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Rendez-vous DA-219, P-01, Prévu', exact: true }),
  ).toBeVisible();
});

test('read-only access retains inspection without offering operational writes', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('pulsar.auth')!);
    session.user.permissions = session.user.permissions.filter((p: string) => p !== 'yard.manage');
    localStorage.setItem('pulsar.auth', JSON.stringify(session));
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Configurer le plan' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Enregistrer une arrivée', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Quai Q-01 — occupé, RF-218', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Visite YV-218', exact: true });
  await expect(panel.getByText('Transport du Fjord', { exact: true })).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Enregistrer le départ', exact: true }),
  ).toHaveCount(0);
});
test('switching site discards old responses instead of mixing occupancy', async ({ page }) => {
  const data = await setup(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/yard/workspace?**', async (r) => {
    if (new URL(r.request().url()).searchParams.get('locationId') === 'yard-site') {
      await pending;
      return r.fulfill({ json: data });
    }
    return r.fulfill({
      json: {
        ...data,
        site: { ...data.site, id: 'other-site', name: 'Site Montréal' },
        visits: [],
        spots: [],
        shapes: [],
        appointments: [],
      },
    });
  });
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await page.getByLabel('Site de travail').selectOption('other-site');
  release();
  await expect(
    page.getByRole('button', { name: 'Quai Q-01 — occupé, RF-218', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('Aucune visite pour ce filtre.', { exact: true })).toBeVisible();
});
test('an incomplete or failed refresh never masquerades as a fully actionable yard', async ({
  page,
}) => {
  const data = await setup(page);
  data.truncated.visits = true;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByText(/Les actions sont désactivées/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Enregistrer une arrivée', exact: true }),
  ).toBeDisabled();
  data.truncated.visits = false;
  await page.route('**/api/v1/yard/workspace?**', (r) =>
    r.fulfill({ status: 503, json: { message: 'Service indisponible' } }),
  );
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Données non actualisées');
  await expect(
    page.getByRole('button', { name: 'Enregistrer une arrivée', exact: true }),
  ).toBeDisabled();
});
test('plan, editor and schedule stay contained on desktop and mobile', async ({ page }) => {
  await setup(page);
  await page.screenshot({
    path: 'playwright-artifacts/yard-workspace-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.getByLabel('Site de travail').boundingBox())!.width).toBeGreaterThan(300);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'playwright-artifacts/yard-workspace-mobile.png', fullPage: true });
  await page.getByRole('tab', { name: 'Planning des quais', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({
    path: 'playwright-artifacts/yard-workspace-schedule.png',
    fullPage: true,
  });
});

test('an empty site explains setup instead of showing a fabricated yard', async ({ page }) => {
  const data = await setup(page);
  await page.route('**/api/v1/yard/workspace?**', (r) =>
    r.fulfill({ json: { ...data, spots: [], shapes: [], visits: [], appointments: [] } }),
  );
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Le plan de ce site reste à préparer' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Gérer les quais et emplacements' })).toHaveAttribute(
    'href',
    '/yard/spots',
  );
  await page.screenshot({ path: 'playwright-artifacts/yard-workspace-empty.png', fullPage: true });
});

test('an unplaced inactive spot is never labeled as free', async ({ page }) => {
  const data = await setup(page);
  await page.route('**/api/v1/yard/workspace?**', (r) =>
    r.fulfill({
      json: {
        ...data,
        spots: data.spots.map((s) =>
          s.id === 'p1' ? { ...s, posX: null, posY: null, isActive: false } : s,
        ),
      },
    }),
  );
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'P-01 · inactif', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'P-01 · libre', exact: true })).toHaveCount(0);
});
