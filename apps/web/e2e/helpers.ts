import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { TOUR_MODULE_KEYS, moduleTourVersion } from '@pulsar/shared';

/**
 * Seeded demo credentials (see packages/database/prisma/seed.ts and CLAUDE.md).
 * Authenticated e2e tests require the API + a seeded database reachable
 * through the web dev server's `/api` proxy.
 */
export const DEMO_USER = {
  email: 'admin@pulsar.dev',
  password: 'admin123',
  tenant: 'acme',
};

/** Explicit experienced-user preferences for isolated UI fixtures, no server write. */
export const EXPERIENCED_PREFERENCES = {
  moduleTours: Object.fromEntries(
    TOUR_MODULE_KEYS.map((k) => [
      k,
      { version: moduleTourVersion(k), step: 0, status: 'COMPLETED' },
    ]),
  ),
  appearance: {},
  deskLayout: {},
};

/** Dedicated account: tutorial completion never changes the demo user's preferences. */
export async function tutorialAccount(request: APIRequestContext) {
  const auth = await request.post('/api/v1/auth/login', { data: DEMO_USER });
  expect(auth.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
  const response = await request.get('/api/v1/roles', { headers });
  expect(response.ok()).toBeTruthy();
  const roles = await response.json();
  const role = (Array.isArray(roles) ? roles : roles.items).find(
    (r: { key: string }) => r.key === 'admin',
  );
  expect(role).toBeTruthy();
  const credentials = {
    tenant: 'acme',
    email: `tutorial-${crypto.randomUUID()}@example.test`,
    password: 'Test1234!',
  };
  const user = await request.post('/api/v1/users', {
    headers,
    data: {
      email: credentials.email,
      password: credentials.password,
      firstName: 'Test',
      lastName: 'Tutoriel isolé',
      roleIds: [role.id],
    },
  });
  expect(user.ok()).toBeTruthy();
  const session = await request.post('/api/v1/auth/login', { data: credentials });
  expect(session.ok()).toBeTruthy();
  return {
    credentials,
    headers: { Authorization: `Bearer ${(await session.json()).accessToken}` },
  };
}

/** Logs in through the real UI form and waits for the authenticated landing route. */
export async function login(page: Page, credentials = DEMO_USER): Promise<void> {
  // Domain tests exercise experienced users. First-entry/replay tours have their own suite.
  // Read this user's real preferences BEFORE installing browser routes. Several shell
  // components load them concurrently: route.fetch() in each handler could still be
  // awaiting the backend when the test navigated away. Do not mask those failures or
  // write fake tutorial completion to the account. Preference persistence tests remove
  // this read-only snapshot explicitly; writes always reach the real API.
  const sessionResponse = await page.request.post('/api/v1/auth/login', { data: credentials });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  const response = await page.request.get('/api/v1/me/preferences', {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  expect(response.ok()).toBeTruthy();
  const preferences = {
    ...(await response.json()),
    moduleTours: EXPERIENCED_PREFERENCES.moduleTours,
  };
  await page.route('**/api/v1/me/preferences', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: preferences }) : route.continue(),
  );
  await page.goto('/login');
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByLabel('Tenant (optional)').fill(credentials.tenant);
  // Do not navigate away while the initial preference route is still being fulfilled.
  // Aborting it during the next page.goto otherwise races with route.fulfill.
  const preferencesReady = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/me/preferences' &&
      response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  const [, initialPreferences] = await Promise.all([
    page.waitForURL('**/dashboard'),
    preferencesReady,
  ]);
  await initialPreferences.finished();
}
