import { test, expect, type Page } from './fixtures';

/**
 * Customer-portal accounts (Task 11). Fully mocked: the portal plane is its own
 * auth world — no tenant `login()` helper, no `pulsar.auth` storage. A session
 * is either obtained through the real login form (test 1) or seeded straight
 * into `pulsar.portal` before the app boots (tests 2 and 3).
 */

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

type Role = 'ADMIN' | 'MEMBER';

const portalSession = (role: Role) => ({
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: {
    id: 'pu-self',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    email: role === 'ADMIN' ? 'ada@client.test' : 'marc@client.test',
    firstName: role === 'ADMIN' ? 'Ada' : 'Marc',
    lastName: 'Nord',
    role,
  },
  customer: { id: 'cust-1', name: 'Client Nord' },
  shipper: { name: 'Acme Logistique' },
  branding: {},
});

const portalView = {
  shipper: 'Acme Logistique',
  customer: 'Client Nord',
  branding: {},
  locations: [],
  orders: [],
};

const shipment = {
  id: 'sh-1',
  shipmentNumber: 'SH-2026-001',
  status: 'IN_TRANSIT',
  plannedPickupEarly: '2026-09-18T08:00:00Z',
  plannedPickupLate: '2026-09-18T12:00:00Z',
  plannedDeliveryEarly: '2026-09-20T08:00:00Z',
  plannedDeliveryLate: '2026-09-20T17:00:00Z',
  actualPickupAt: '2026-09-18T09:12:00Z',
  actualDeliveryAt: null,
  weightKg: 1200,
  palletCount: 4,
  documentCount: 1,
  hasPod: true,
  lastPosition: null,
  trackingUrl: null,
};

const order = {
  id: 'to-1',
  orderNumber: 'TO-2026-0042',
  customerReference: 'PO-987',
  status: 'CONFIRMED',
  mode: 'FTL',
  totalWeightKg: 1200,
  totalVolumeM3: null,
  palletCount: 4,
  notes: 'Quai 3, appeler avant.',
  requestedPickupEarly: '2026-09-18T08:00:00Z',
  requestedPickupLate: null,
  requestedDeliveryEarly: '2026-09-20T08:00:00Z',
  requestedDeliveryLate: null,
  createdAt: '2026-09-15T10:00:00Z',
  updatedAt: '2026-09-16T10:00:00Z',
  originLocation: { city: 'Montréal', state: 'QC' },
  destinationLocation: { city: 'Toronto', state: 'ON' },
  shipments: [shipment],
};

/** `GET /portal/shipments/:id` — the tracking projection (rule 20). */
const tracking = {
  shipper: 'Acme Logistique',
  shipmentNumber: 'SH-2026-001',
  status: 'IN_TRANSIT',
  origin: { city: 'Montréal', state: 'QC', latitude: 45.5, longitude: -73.57 },
  destination: { city: 'Toronto', state: 'ON', latitude: 43.65, longitude: -79.38 },
  plannedPickupEarly: '2026-09-18T08:00:00Z',
  plannedPickupLate: '2026-09-18T12:00:00Z',
  plannedDeliveryEarly: '2026-09-20T08:00:00Z',
  plannedDeliveryLate: '2026-09-20T17:00:00Z',
  actualPickupAt: '2026-09-18T09:12:00Z',
  actualDeliveryAt: null,
  proofOfDelivery: { signedByName: 'Julie Tremblay', signedAt: '2026-09-20T15:04:00Z' },
  events: [
    {
      id: 'ev-1',
      type: 'IN_TRANSIT',
      message: 'Départ du terminal de Montréal',
      occurredAt: '2026-09-18T10:00:00Z',
    },
  ],
  lastPosition: null,
};

const colleague = {
  id: 'pu-2',
  email: 'nina@client.test',
  firstName: 'Nina',
  lastName: 'Roy',
  role: 'MEMBER',
  status: 'INVITED',
  lastLoginAt: null,
  createdAt: '2026-09-10T12:00:00Z',
  invitation: { expiresAt: '2026-09-20T12:00:00Z', expired: false },
};

const INVITE_URL = 'http://localhost:5173/portal/activate/tok-abc123';

interface State {
  role: Role;
  users: (typeof colleague)[];
  writes: { path: string; method: string; body: unknown }[];
  /** Query strings of every `GET /orders` round-trip, to assert the filters. */
  orderQueries: string[];
}

async function mockPortalApi(page: Page, role: Role): Promise<State> {
  const state: State = { role, users: [], writes: [], orderQueries: [] };
  await page.route('**/api/v1/portal/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1/portal', '');
    if (request.method() !== 'GET') {
      state.writes.push({ path, method: request.method(), body: request.postDataJSON() });
    }
    if (path === '/auth/login') return route.fulfill({ json: portalSession(state.role) });
    if (path === '/view') return route.fulfill({ json: portalView });
    if (path === '/templates') return route.fulfill({ json: [] });
    if (path === '/orders' && request.method() === 'GET') {
      const url = new URL(request.url());
      state.orderQueries.push(url.search);
      const status = url.searchParams.get('status');
      const items = !status || status === order.status ? [order] : [];
      return route.fulfill({ json: { items, total: items.length, page: 1, pageSize: 20 } });
    }
    if (path === '/shipments/sh-1') return route.fulfill({ json: tracking });
    if (path === '/shipments/sh-1/documents') return route.fulfill({ json: [] });
    if (path === '/shipments/sh-1/comments' && request.method() === 'GET')
      return route.fulfill({ json: [] });
    if (path === '/invoices') return route.fulfill({ json: [] });
    if (path === '/change-requests') return route.fulfill({ json: [] });
    if (path === '/auth/forgot-password') return route.fulfill({ json: { ok: true } });
    if (path === '/users' && request.method() === 'GET')
      return route.fulfill({ json: state.users });
    if (path === '/users' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, string>;
      const created = {
        ...colleague,
        id: 'pu-3',
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        role: body.role,
      };
      state.users = [...state.users, created];
      return route.fulfill({ status: 201, json: { ...created, inviteUrl: INVITE_URL } });
    }
    return route.fulfill({
      status: 404,
      json: { message: `Unexpected ${request.method()} ${path}` },
    });
  });
  return state;
}

/** Seeds a portal session before any app code runs (no login round-trip). */
async function seedSession(page: Page, role: Role) {
  await page.addInitScript(
    (session) => localStorage.setItem('pulsar.portal', JSON.stringify(session)),
    portalSession(role),
  );
}

test('a portal admin signs in and lands on the authenticated workspace', async ({ page }) => {
  const state = await mockPortalApi(page, 'ADMIN');
  await page.goto('/portal/login');
  await page.getByLabel('Courriel').fill('ada@client.test');
  await page.getByLabel('Mot de passe').fill('portal1234');
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page).toHaveURL(/\/portal\/dashboard$/);
  const nav = page.getByRole('navigation', { name: 'Portail client' });
  await expect(nav.getByRole('link', { name: 'Commandes' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Utilisateurs' })).toBeVisible();
  // The full-width shell replaced the centred card: the company sits in the top
  // bar and the greeting moved into the account menu button.
  await expect(page.getByTestId('portal-customer')).toHaveText('Client Nord');
  await expect(page.getByRole('button', { name: /Votre compte/ })).toBeVisible();
  expect(state.writes[0]).toMatchObject({
    path: '/auth/login',
    body: { email: 'ada@client.test', password: 'portal1234' },
  });
});

test('a member never reaches colleague management', async ({ page }) => {
  await mockPortalApi(page, 'MEMBER');
  await seedSession(page, 'MEMBER');
  await page.goto('/portal/orders');

  const nav = page.getByRole('navigation', { name: 'Portail client' });
  await expect(nav.getByRole('link', { name: 'Demandes' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Utilisateurs' })).toHaveCount(0);

  await page.goto('/portal/users');
  await expect(page).toHaveURL(/\/portal\/dashboard$/);
  await expect(page.getByRole('button', { name: 'Inviter un collègue' })).toHaveCount(0);
});

test('an admin invites a colleague and gets the activation link back', async ({ page }) => {
  const state = await mockPortalApi(page, 'ADMIN');
  state.users = [colleague];
  await seedSession(page, 'ADMIN');
  await page.goto('/portal/users');
  await expect(page.getByRole('cell', { name: 'nina@client.test' })).toBeVisible();

  await page.getByRole('button', { name: 'Inviter un collègue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Inviter un collègue' });
  await dialog.getByLabel('Courriel').fill('leo@client.test');
  await dialog.getByLabel('Prénom').fill('Léo');
  await dialog.getByLabel('Nom', { exact: true }).fill('Blais');
  await dialog.getByLabel('Rôle').selectOption('ADMIN');
  await dialog.getByRole('button', { name: 'Envoyer l’invitation' }).click();

  await expect.poll(() => state.writes.filter((w) => w.path === '/users').length).toBe(1);
  expect(state.writes.find((w) => w.path === '/users')?.body).toEqual({
    email: 'leo@client.test',
    firstName: 'Léo',
    lastName: 'Blais',
    role: 'ADMIN',
  });
  await expect(page.getByRole('status')).toContainText(INVITE_URL);
  await expect(page.getByRole('cell', { name: 'leo@client.test' })).toBeVisible();
});

test('the orders workspace filters, paginates and opens an order', async ({ page }) => {
  const state = await mockPortalApi(page, 'MEMBER');
  await seedSession(page, 'MEMBER');
  await page.goto('/portal/orders');

  // The table renders the mocked page.
  await expect(page.getByRole('cell', { name: 'TO-2026-0042' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Montréal, QC → Toronto, ON' })).toBeVisible();

  // Filtering by status re-queries the API with `status=…`.
  await page.getByLabel('Statut').selectOption('CANCELLED');
  await expect
    .poll(() => state.orderQueries.some((q) => q.includes('status=CANCELLED')))
    .toBe(true);
  await expect(page.getByText('Aucune commande ne correspond')).toBeVisible();

  // Back to everything, then open the detail drawer.
  await page.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
  await page.getByRole('cell', { name: 'TO-2026-0042' }).click();
  const drawer = page.getByRole('dialog', { name: 'Commande TO-2026-0042' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('Quai 3, appeler avant.')).toBeVisible();
  await expect(drawer.getByRole('cell', { name: 'SH-2026-001' })).toBeVisible();
});

test('« Mon compte » shows the account and can request a password reset', async ({ page }) => {
  const state = await mockPortalApi(page, 'MEMBER');
  await seedSession(page, 'MEMBER');
  await page.goto('/portal/orders');

  const nav = page.getByRole('navigation', { name: 'Portail client' });
  await nav.getByRole('link', { name: 'Mon compte' }).click();
  await expect(page).toHaveURL(/\/portal\/account$/);

  await expect(page.getByText('marc@client.test')).toBeVisible();
  // "Client Nord" also appears in the top bar and the sidebar footer — scope
  // to the main content, where the account card renders it.
  await expect(page.locator('#portal-content').getByText('Client Nord')).toBeVisible();

  await page.getByRole('button', { name: 'Réinitialiser mon mot de passe' }).click();
  await expect.poll(() => state.writes.some((w) => w.path === '/auth/forgot-password')).toBe(true);
  expect(state.writes.find((w) => w.path === '/auth/forgot-password')?.body).toEqual({
    email: 'marc@client.test',
  });
  await expect(page.getByText(/courriel de réinitialisation a été envoyé/)).toBeVisible();
});

test('dashboard renders the 5 KPI tiles and the live map for in-transit shipments', async ({
  page,
}) => {
  await mockPortalApi(page, 'MEMBER');
  const movingShipment = {
    ...shipment,
    id: 'sh-2',
    shipmentNumber: 'SH-2026-002',
    status: 'IN_TRANSIT',
    lastPosition: { latitude: 45.5, longitude: -73.57, recordedAt: '2026-09-18T12:00:00Z' },
  };
  const dashboardView = {
    ...portalView,
    orders: [{ ...order, id: 'to-2', orderNumber: 'TO-2026-0099', shipments: [movingShipment] }],
  };
  // Overrides only `/view` — registered after `mockPortalApi`'s catch-all, so
  // Playwright resolves it first for this one path (last-registered wins).
  await page.route('**/api/v1/portal/view', (route) => route.fulfill({ json: dashboardView }));
  await seedSession(page, 'MEMBER');
  await page.goto('/portal/dashboard');

  // Scoped to the KPI figures (uppercase labels under each big number) — some
  // of these labels are reused verbatim as section headings further down.
  const tileLabel = (label: string) => page.locator('.uppercase', { hasText: label }).first();
  for (const label of [
    'Commandes actives',
    'Expéditions en transit',
    'Livrées (30 j)',
    'Factures à payer',
    'Demandes ouvertes',
  ]) {
    await expect(tileLabel(label)).toBeVisible();
  }

  // The live map (rule 20: one position per moving shipment, no history).
  const map = page.getByRole('img', { name: /Carte des expéditions en transit/ });
  await expect(map).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
});

test('« Suivre » opens the shipment tracking drawer', async ({ page }) => {
  await mockPortalApi(page, 'MEMBER');
  await seedSession(page, 'MEMBER');
  await page.goto('/portal/orders');

  await page.getByRole('cell', { name: 'TO-2026-0042' }).click();
  await page.getByRole('button', { name: 'Suivre' }).click();

  const tracker = page.getByRole('dialog', { name: 'Suivi SH-2026-001' });
  await expect(tracker).toBeVisible();
  // French status, POD signer and the timeline event all come from the payload.
  await expect(tracker.getByText('En transit').first()).toBeVisible();
  await expect(tracker.getByText('Julie Tremblay')).toBeVisible();
  await expect(tracker.getByText('Départ du terminal de Montréal')).toBeVisible();
});
