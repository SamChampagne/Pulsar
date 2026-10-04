import { test, expect, type Page } from './fixtures';

// No real capability link, tenant or API is used by these mobile fixtures.
const token = 'fixture-driver-capability-only';
const version = '2026-10-02T16:00:00.000Z';
const ref = (letter: string) => letter.repeat(43);
function packageFixture(code = 'PKG-0001', status = 'PREPARED') {
  return {
    ref: ref(code === 'PKG-0001' ? 'A' : 'B'),
    code,
    label: 'Composants assemblage nord',
    status,
    version: 1,
    contents: [
      { reference: 'AX-84', description: 'Axes usinés', quantity: '12', unit: 'pièce' },
      { reference: 'RES-2', description: 'Résine de montage', quantity: '1.375', unit: 'kg' },
    ],
    loadedAt: status === 'LOADED' ? version : (null as string | null),
    deliveredAt: null as string | null,
  };
}
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});

async function setup(
  page: Page,
  options: {
    status?: string;
    packages?: ReturnType<typeof packageFixture>[];
    invalid?: boolean;
    hasPod?: boolean;
  } = {},
) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'fixtureGeoCalls', { value: 0, writable: true });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(
          callback: (position: { coords: { latitude: number; longitude: number } }) => void,
        ) {
          (window as unknown as { fixtureGeoCalls: number }).fixtureGeoCalls++;
          callback({ coords: { latitude: 46.82, longitude: -71.22 } });
        },
      },
    });
  });
  const state = {
    status: options.status ?? 'IN_TRANSIT',
    shipmentStatus: 'IN_TRANSIT',
    updatedAt: version,
    packages: options.packages ?? [packageFixture(), packageFixture('PKG-0002', 'LOADED')],
    hasPod: options.hasPod ?? false,
    invalid: options.invalid ?? false,
    invalidStatus: 410,
    acceptThenFail: false,
    conflict: false,
    failRead: false,
  };
  const requests: { path: string; method: string; body: any }[] = [];
  const receipts = new Map<string, object>();
  const mission = () => ({
    loadNumber: 'LD-MOBILE',
    status: state.status,
    updatedAt: state.updatedAt,
    shipments: !['DISPATCHED', 'IN_TRANSIT'].includes(state.status)
      ? []
      : [
          {
            ref: ref('S'),
            shipmentNumber: 'SH-COMPOSANTS',
            status: state.shipmentStatus,
            originName: 'Atelier Laval',
            destinationName: 'Usine Québec',
            hasPod: state.hasPod,
            packages: state.packages,
          },
        ],
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method();
    if (!path.startsWith('/api/v1/public/driver/')) return route.fulfill({ json: [] });
    const body =
      request.postData() && request.headers()['content-type']?.includes('application/json')
        ? request.postDataJSON()
        : null;
    requests.push({ path, method, body });
    if (state.invalid)
      return route.fulfill({
        status: state.invalidStatus,
        json: { message: 'Ce lien chauffeur est expiré ou révoqué.' },
      });
    if (path.endsWith('/documents') && method === 'GET')
      return route.fulfill({ json: { documents: [], message: 'Aucun document publié.' } });
    if (path.endsWith('/packages') && method === 'GET') {
      return state.failRead
        ? route.fulfill({ status: 503, json: { message: 'Colis indisponibles.' } })
        : route.fulfill({ json: mission() });
    }
    const match = path.match(/\/packages\/([^/]+)\/(transition|exception)$/);
    if (match && method === 'POST') {
      if (receipts.has(body.operationKey))
        return route.fulfill({ json: receipts.get(body.operationKey) });
      const pkg = state.packages.find((p) => p.ref === match[1]);
      if (!pkg) throw new Error('Unexpected fixture package reference');
      if (
        state.conflict ||
        body.expectedVersion !== pkg.version ||
        body.expectedLoadUpdatedAt !== state.updatedAt
      )
        return route.fulfill({
          status: 409,
          json: { message: 'La mission a changé. Vérifiez son état actuel.' },
        });
      const receipt =
        match[2] === 'exception'
          ? { operationKey: body.operationKey, ref: pkg.ref, code: pkg.code, recorded: true }
          : {
              operationKey: body.operationKey,
              ref: pkg.ref,
              code: pkg.code,
              version: pkg.version + 1,
              status: body.target,
            };
      if (match[2] === 'transition') {
        pkg.status = body.target;
        pkg.version++;
        if (body.target === 'LOADED') pkg.loadedAt = version;
        if (body.target === 'DELIVERED') pkg.deliveredAt = version;
        if (
          state.packages
            .filter((p) => p.status !== 'CANCELLED')
            .every((p) => p.status === 'DELIVERED')
        )
          state.shipmentStatus = 'DELIVERED';
      }
      state.updatedAt = new Date(Date.parse(state.updatedAt) + 1000).toISOString();
      receipts.set(body.operationKey, receipt);
      if (state.acceptThenFail) {
        state.acceptThenFail = false;
        return route.fulfill({ status: 503, json: { message: 'Réponse perdue.' } });
      }
      return route.fulfill({ json: receipt });
    }
    if (path.endsWith('/pod') && method === 'POST') {
      state.hasPod = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/position') && method === 'POST')
      return route.fulfill({ json: { ok: true } });
    if (/\/stops\/.+\/status$/.test(path)) return route.fulfill({ json: { ok: true } });
    if (path.endsWith('/exception') && method === 'POST')
      return route.fulfill({ json: { ok: true } });
    if (method === 'GET')
      return route.fulfill({
        json: {
          shipper: 'Composants du Nord',
          carrier: 'Transport Boréal',
          loadNumber: 'LD-MOBILE',
          status: state.status,
          shipments: [
            {
              id: ref('S'),
              shipmentNumber: 'SH-COMPOSANTS',
              status: state.shipmentStatus,
              hasPod: state.hasPod,
            },
          ],
          stops: [
            {
              id: ref('P'),
              sequence: 1,
              type: 'PICKUP',
              status: 'ARRIVED',
              plannedArrivalEarly: version,
              plannedArrivalLate: null,
              actualArrivalAt: version,
              actualDepartureAt: null,
              location: {
                name: 'Atelier Laval',
                addressLine1: '180 boulevard Industriel',
                city: 'Laval',
                state: 'QC',
              },
            },
            {
              id: ref('D'),
              sequence: 2,
              type: 'DELIVERY',
              status: 'ARRIVED',
              plannedArrivalEarly: version,
              plannedArrivalLate: null,
              actualArrivalAt: version,
              actualDepartureAt: null,
              location: {
                name: 'Usine Québec',
                addressLine1: '845 avenue Production',
                city: 'Québec',
                state: 'QC',
              },
            },
          ],
        },
      });
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  });
  await page.goto(`/driver/${token}`);
  if (!state.invalid) {
    await expect(page.getByRole('heading', { name: 'LD-MOBILE' })).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: 'Colis à distribuer' })).toBeVisible();
    if (['DISPATCHED', 'IN_TRANSIT'].includes(state.status))
      await expect(panel(page).getByRole('heading', { name: 'Usine Québec' })).toBeVisible();
  }
  return { state, requests, writes: () => requests.filter((request) => request.method !== 'GET') };
}
const panel = (page: Page) =>
  page.getByRole('region', { name: 'Colis de la mission', exact: true });
async function confirm(page: Page) {
  await page
    .getByRole('dialog', { name: 'Confirmer l’action chauffeur', exact: true })
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
}
async function closeDrawer(page: Page) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Fermer', exact: true })
    .last()
    .click();
}

test('exact scanner selection reveals quantities but never performs a transition', async ({
  page,
}, info) => {
  const { writes } = await setup(page);
  await panel(page).getByLabel('Scanner ou saisir le code exact').fill('PKG-000');
  await panel(page).getByRole('button', { name: 'Repérer le colis' }).click();
  await expect(panel(page)).toContainText('Code exact introuvable');
  await panel(page).getByLabel('Scanner ou saisir le code exact').fill('PKG-0001');
  await panel(page).getByLabel('Scanner ou saisir le code exact').press('Enter');
  const pkg = panel(page).getByRole('article', { name: 'Colis PKG-0001', exact: true });
  await expect(pkg).toContainText('Sélectionné');
  await expect(pkg).toBeInViewport();
  await expect(pkg).toBeFocused();
  await expect(pkg.getByText('1.375 kg', { exact: true })).toBeVisible();
  expect(writes()).toHaveLength(0);
  await expect(page.getByRole('link', { name: /connaissement|BOL/ })).toHaveCount(0);
  await pkg.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: info.outputPath('driver-packages-mobile.png'),
    animations: 'disabled',
  });
});

test('physical loading requires confirmation and captures package and mission versions', async ({
  page,
}) => {
  const { writes, state } = await setup(page);
  await panel(page).getByRole('button', { name: 'Charger PKG-0001', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Confirmer le chargement · PKG-0001', exact: true })
    .getByRole('button', { name: 'Confirmer', exact: true })
    .click();
  expect(writes()).toHaveLength(0);
  await confirm(page);
  await expect(panel(page)).toContainText('PKG-0001 : chargement confirmé.');
  expect(writes()[0].body).toMatchObject({
    target: 'LOADED',
    expectedVersion: 1,
    expectedLoadUpdatedAt: version,
  });
  expect(state.packages[0].status).toBe('LOADED');
});

test('last package suggests POD capture then refreshes legacy status after the real handoff', async ({
  page,
}) => {
  const { writes, state } = await setup(page, { packages: [packageFixture('PKG-0001', 'LOADED')] });
  await panel(page).getByRole('button', { name: 'Remettre PKG-0001', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Dernier colis de cette expédition');
  await page.getByRole('button', { name: 'Ouvrir la preuve de livraison', exact: true }).click();
  const pod = page.getByRole('region', { name: 'Preuve de livraison', exact: true });
  await expect(pod.getByLabel('Expédition', { exact: true })).toHaveValue(ref('S'));
  await pod.getByLabel('Nom du destinataire', { exact: true }).fill('Nadia Tremblay');
  await pod
    .getByRole('button', { name: 'Enregistrer la preuve de livraison', exact: true })
    .click();
  await expect(pod).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Remettre PKG-0001', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Ouvrir la preuve de livraison' })).toHaveCount(
    0,
  );
  await expect(dialog.getByRole('button', { name: 'Confirmer', exact: true })).toBeDisabled();
  await dialog.getByLabel('Nom du destinataire').fill('Nadia Tremblay');
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await confirm(page);
  await expect(panel(page)).toContainText('1 / 1 colis remis');
  expect(writes().filter((w) => w.path.endsWith('/transition'))[0].body.recipientName).toBe(
    'Nadia Tremblay',
  );
  expect(state.shipmentStatus).toBe('DELIVERED');
});

test('incident captures a required explanation without changing the package status', async ({
  page,
}) => {
  const { writes, state } = await setup(page);
  await panel(page).getByRole('button', { name: 'Incident PKG-0001', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ne confirme aucune livraison');
  await expect(dialog.getByRole('button', { name: 'Confirmer', exact: true })).toBeDisabled();
  await dialog.getByLabel('Type d’incident').selectOption('MISSING');
  await expect(dialog.getByLabel('Type d’incident').locator('option[value="ABSENT"]')).toHaveText(
    'Destinataire absent',
  );
  await dialog
    .getByLabel('Description de l’incident')
    .fill('Absent du quai au moment du chargement.');
  await dialog.getByRole('button', { name: 'Confirmer', exact: true }).click();
  await confirm(page);
  await expect(panel(page)).toContainText('Son statut de livraison est inchangé.');
  expect(writes()[0].body).toMatchObject({
    kind: 'MISSING',
    note: 'Absent du quai au moment du chargement.',
    expectedVersion: 1,
  });
  expect(state.packages[0].status).toBe('PREPARED');
});

test('uncertain action stores only hashed scope and exact body then replays without duplicate work', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  state.acceptThenFail = true;
  await panel(page).getByRole('button', { name: 'Charger PKG-0001', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await confirm(page);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Réponse incertaine');
  const saved = await page.evaluate(() => Object.entries(sessionStorage));
  const entry = saved.find(([key]) => key.startsWith('pulsar.driver-packages.pending.v1:'))!;
  expect(entry[0]).toMatch(/:[0-9a-f]{64}$/);
  expect(JSON.stringify(entry)).not.toContain(token);
  expect(JSON.stringify(entry)).not.toContain('Composants du Nord');
  expect(JSON.parse(entry[1]).body).toEqual(writes()[0].body);
  await closeDrawer(page);
  await page.reload();
  await panel(page).getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
  await expect(
    panel(page).getByRole('button', { name: 'Reprendre la même demande', exact: true }),
  ).toHaveCount(0);
  expect(writes()).toHaveLength(2);
  expect(writes()[1]).toEqual(writes()[0]);
  expect(state.packages[0].version).toBe(2);
});

test('stale mission stays explicit and preserves the pending request for verification', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  await panel(page).getByRole('button', { name: 'Charger PKG-0001', exact: true }).click();
  state.updatedAt = '2026-10-02T17:00:00.000Z';
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await confirm(page);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('La mission a changé');
  await closeDrawer(page);
  await expect(panel(page).getByRole('button', { name: 'Charger PKG-0001' })).toBeDisabled();
  expect(writes()).toHaveLength(1);
  expect(writes()[0].body.expectedLoadUpdatedAt).toBe(version);
});

test('offline blocks actions and reconnect does not flush an automatic queue', async ({ page }) => {
  const { writes } = await setup(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
  await expect(panel(page)).toContainText('Hors connexion.');
  await expect(panel(page).getByRole('button', { name: 'Charger PKG-0001' })).toBeDisabled();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await expect(panel(page).getByRole('button', { name: 'Charger PKG-0001' })).toBeEnabled();
  expect(writes()).toHaveLength(0);
});

test('location remains off until the driver explicitly enables it', async ({ page }) => {
  const { writes } = await setup(page);
  await expect(
    page.getByRole('button', { name: 'Partager ma position', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { fixtureGeoCalls: number }).fixtureGeoCalls),
  ).toBe(0);
  await page.getByRole('button', { name: 'Partager ma position', exact: true }).click();
  await expect.poll(() => writes().filter((w) => w.path.endsWith('/position')).length).toBe(1);
  await page.getByRole('button', { name: 'Arrêter', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Partager ma position', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { fixtureGeoCalls: number }).fixtureGeoCalls),
  ).toBe(0);
});

test('closed mission exposes no stop, package, POD or incident mutations', async ({ page }) => {
  const { writes } = await setup(page, {
    status: 'COMPLETED',
    packages: [packageFixture('PKG-0001', 'DELIVERED')],
  });
  await expect(panel(page)).toContainText('Mission clôturée : consultation seulement.');
  await expect(
    page.getByRole('button', {
      name: /Charger PKG|Remettre PKG|Incident PKG|Signaler un problème|Confirmer le départ|Confirmer l’arrivée|Enregistrer la preuve/,
    }),
  ).toHaveCount(0);
  expect(writes()).toHaveLength(0);
});

test('expired capability shows no stale mission or controls', async ({ page }) => {
  const { writes } = await setup(page, { invalid: true });
  await expect(
    page.getByText('Ce lien chauffeur est expiré ou révoqué.', { exact: true }),
  ).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  expect(writes()).toHaveLength(0);
});

test('package read failure disables actions until an explicit successful refresh', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  state.failRead = true;
  await panel(page).getByRole('button', { name: 'Actualiser les colis', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('Colis indisponibles.');
  await expect(panel(page).getByRole('button', { name: 'Charger PKG-0001' })).toHaveCount(0);
  state.failRead = false;
  await panel(page).getByRole('button', { name: 'Réessayer', exact: true }).click();
  await expect(panel(page).getByRole('button', { name: 'Charger PKG-0001' })).toBeEnabled();
  expect(writes()).toHaveLength(0);
});

test('new link does not replay another capability request', async ({ page }) => {
  const { state, writes } = await setup(page);
  state.acceptThenFail = true;
  await panel(page).getByRole('button', { name: 'Charger PKG-0001' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await confirm(page);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Réponse incertaine');
  await page.goto('/driver/fixture-other-capability-only');
  await expect(panel(page).getByRole('heading', { name: 'Usine Québec' })).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Reprendre la même demande' })).toHaveCount(
    0,
  );
  expect(writes()).toHaveLength(1);
});

test('revocation after a lost receipt retains the exact request and hides stale actions', async ({
  page,
}) => {
  const { state, writes } = await setup(page);
  state.acceptThenFail = true;
  await panel(page).getByRole('button', { name: 'Charger PKG-0001' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await confirm(page);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Réponse incertaine');
  await closeDrawer(page);
  state.invalid = true;
  state.invalidStatus = 404;
  await panel(page).getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
  await expect(
    page.getByText('Ce lien chauffeur est expiré ou révoqué.', { exact: true }),
  ).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  const saved = await page.evaluate(() =>
    Object.entries(sessionStorage).find(([key]) =>
      key.startsWith('pulsar.driver-packages.pending.v1:'),
    ),
  );
  expect(JSON.parse(saved![1]).body).toEqual(writes()[0].body);
  expect(writes()).toHaveLength(2);
  expect(state.packages[0].version).toBe(2);
});

test('an existing receipt can be recovered after mission closure without enabling new mutations', async ({
  page,
}) => {
  const { state, writes } = await setup(page, {
    packages: [packageFixture('PKG-0001', 'LOADED')],
    hasPod: true,
  });
  state.acceptThenFail = true;
  await panel(page).getByRole('button', { name: 'Remettre PKG-0001' }).click();
  await page.getByRole('dialog').getByLabel('Nom du destinataire').fill('Nadia Tremblay');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
  await confirm(page);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Réponse incertaine');
  state.status = 'COMPLETED';
  await page.reload();
  await expect(panel(page)).toContainText('Mission clôturée : consultation seulement.');
  await panel(page).getByRole('button', { name: 'Reprendre la même demande', exact: true }).click();
  await expect(
    panel(page).getByRole('button', { name: 'Reprendre la même demande', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Charger PKG|Remettre PKG|Incident PKG|Confirmer le départ/ }),
  ).toHaveCount(0);
  expect(writes()).toHaveLength(2);
  expect(writes()[1]).toEqual(writes()[0]);
  expect(state.packages[0].version).toBe(2);
});
