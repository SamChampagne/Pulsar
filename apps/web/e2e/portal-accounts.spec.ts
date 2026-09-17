import { test, expect, type Page } from '@playwright/test';

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
}

async function mockPortalApi(page: Page, role: Role): Promise<State> {
  const state: State = { role, users: [], writes: [] };
  await page.route('**/api/v1/portal/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1/portal', '');
    if (request.method() !== 'GET') {
      state.writes.push({ path, method: request.method(), body: request.postDataJSON() });
    }
    if (path === '/auth/login') return route.fulfill({ json: portalSession(state.role) });
    if (path === '/view') return route.fulfill({ json: portalView });
    if (path === '/templates') return route.fulfill({ json: [] });
    if (path === '/invoices') return route.fulfill({ json: [] });
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

  await expect(page).toHaveURL(/\/portal\/orders$/);
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
  await expect(page).toHaveURL(/\/portal\/orders$/);
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
