import { test, expect, type Page } from './fixtures';
import { login } from './helpers';

/**
 * Staff queue for change requests filed from the customer portal (Task B5).
 * Real tenant login (the seeded `admin` role has every module + permission),
 * mocked `/customer-portal/change-requests` payloads.
 */

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

const openRequest = {
  id: 'cr-1',
  kind: 'DATE',
  note: 'Reporter la livraison au vendredi.',
  status: 'OPEN',
  staffResponse: null,
  orderNumber: 'TO-2026-0042',
  shipmentNumber: 'SH-2026-001',
  createdAt: '2026-09-16T10:00:00Z',
  resolvedAt: null,
  customerName: 'Client Nord',
  requestedBy: 'Marc Nord',
  updatedAt: '2026-09-16T10:00:00Z',
};

interface State {
  requests: (typeof openRequest)[];
  writes: { path: string; method: string; body: unknown }[];
}

async function mockChangeRequests(page: Page): Promise<State> {
  const state: State = { requests: [openRequest], writes: [] };
  await page.route('**/api/v1/customer-portal/change-requests**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(
      '/api/v1/customer-portal/change-requests',
      '',
    );
    if (request.method() === 'GET') return route.fulfill({ json: state.requests });
    state.writes.push({ path, method: request.method(), body: request.postDataJSON() });
    if (path === '/cr-1/resolve') {
      state.requests = state.requests.map((r) =>
        r.id === 'cr-1'
          ? {
              ...r,
              status: 'RESOLVED',
              staffResponse: (request.postDataJSON() as { response?: string })?.response ?? null,
            }
          : r,
      );
      return route.fulfill({ json: state.requests[0] });
    }
    if (path === '/cr-1/acknowledge') {
      state.requests = state.requests.map((r) =>
        r.id === 'cr-1' ? { ...r, status: 'ACKNOWLEDGED' } : r,
      );
      return route.fulfill({ json: state.requests[0] });
    }
    return route.fulfill({ status: 404, json: { message: `Unexpected ${path}` } });
  });
  return state;
}

test('staff resolves a portal change request with a response', async ({ page }) => {
  await login(page);
  const state = await mockChangeRequests(page);
  await page.goto('/customer-portal/requests');

  await expect(page.getByRole('cell', { name: 'Client Nord' })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Reporter la livraison au vendredi.' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Résoudre' }).click();
  const dialog = page.getByRole('dialog', { name: 'Résoudre la demande' });
  await dialog.getByLabel('Réponse (optionnel)').fill('Livraison confirmée pour vendredi.');
  await dialog.getByRole('button', { name: 'Résoudre' }).click();

  await expect.poll(() => state.writes.some((w) => w.path === '/cr-1/resolve')).toBe(true);
  expect(state.writes.find((w) => w.path === '/cr-1/resolve')?.body).toEqual({
    response: 'Livraison confirmée pour vendredi.',
  });
});

test('the « Portail client » domain nav lists the requests queue', async ({ page }) => {
  await login(page);
  await mockChangeRequests(page);
  // `/customer-portal/*` is the domain's own prefix — the domain sidebar
  // shows the « Demandes » link (and its sibling « Clients & portail ») only
  // once the current route falls under it.
  await page.goto('/customer-portal/requests');

  await expect(page.getByRole('heading', { name: 'Demandes du portail client' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Menu du module sélectionné' });
  await expect(nav.getByRole('link', { name: 'Demandes' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Clients & portail' })).toBeVisible();
});

test('the domain switcher reaches the requests queue via the domain home', async ({ page }) => {
  await login(page);
  await mockChangeRequests(page);
  await page.goto('/dashboard');

  // The domain's `home` must fall under its own prefix (`/customer-portal`)
  // or the switcher lands on a route owned by a different domain and its
  // sidebar never appears (regression covered here: fix round 1).
  await page.getByRole('button', { name: 'Changer d’application' }).click();
  const switcher = page.getByRole('dialog', { name: 'Changer d’application' });
  const portalTile = switcher.getByRole('link', { name: 'Portail client' });
  await portalTile.waitFor({ state: 'visible' });
  // The tile's own transition-in (Modal `scale`) briefly reports as "not
  // stable" to Playwright's actionability check; force past that instead of
  // retrying the click into a timeout.
  await portalTile.click({ force: true });

  await expect(page).toHaveURL(/\/customer-portal\/requests$/);
  const nav = page.getByRole('navigation', { name: 'Menu du module sélectionné' });
  await expect(nav.getByRole('link', { name: 'Demandes' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Clients & portail' })).toBeVisible();
});
