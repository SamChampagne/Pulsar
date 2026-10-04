import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';
import type { DeliveryOperationRow } from '@pulsar/shared';
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});
function row(page: number): DeliveryOperationRow {
  return {
    id: `load-${page}`,
    loadNumber: `LD-${page === 1 ? '8042' : '8038'}`,
    status: 'IN_TRANSIT',
    updatedAt: '2026-10-03T12:00:00.000Z',
    shipmentCount: 3,
    shipmentsWithoutPackages: 0,
    packages: { total: 7, prepared: 0, loaded: 2, delivered: 4, returned: 1, cancelled: 0 },
    exceptions: { open: 1, retry: 0, returnAuthorized: 1, returnReceived: 1 },
    nextAction: {
      label: 'Examiner les incidents',
      href: `/loads/load-${page}`,
      reason: 'Un incident ouvert exige une décision de l’exploitation.',
    },
  };
}
async function setup(page: Page, canRead = true, canChat = false) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ canRead, canChat }) =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'fixture-token',
          refreshToken: 'fixture-refresh',
          user: {
            id: 'operator',
            firstName: 'Camille',
            lastName: 'Recette',
            email: 'fixture@example.invalid',
            permissions: [
              ...(canRead ? ['transportation.planning.read'] : []),
              ...(canChat ? ['core.agents.chat'] : []),
            ],
          },
          tenant: {
            id: 'fixture',
            name: 'Composants du Nord',
            slug: 'fixture',
            enabledModules: ['transportation'],
          },
        }),
      ),
    { canRead, canChat },
  );
  const requests: {
    method: string;
    page: string | null;
    filter: string | null;
    search: string | null;
  }[] = [];
  const state = { fail: false, empty: false };
  const mutations: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (route.request().method() !== 'GET') mutations.push(path);
    if (path.endsWith('/agent-conversations/workers'))
      return route.fulfill({
        json: [
          {
            id: 'worker-fixture',
            name: 'Camille opérations',
            role: 'Coordination livraison',
            model: 'fixture-model',
            status: 'ACTIVE',
          },
        ],
      });
    if (path.endsWith('/delivery-operations')) {
      requests.push({
        method: route.request().method(),
        page: url.searchParams.get('page'),
        filter: url.searchParams.get('filter'),
        search: url.searchParams.get('search'),
      });
      if (state.fail)
        return route.fulfill({
          status: 503,
          json: { message: 'Lecture indisponible, réessayez.' },
        });
      const p = Number(url.searchParams.get('page')) || 1;
      return route.fulfill({
        json: {
          items: state.empty ? [] : [row(p)],
          total: state.empty ? 0 : 41,
          page: p,
          pageSize: 20,
          observedAt: '2026-10-03T12:05:00.000Z',
        },
      });
    }
    return route.fulfill({
      json: path.endsWith('/preferences')
        ? EXPERIENCED_PREFERENCES
        : path.endsWith('/unseen-count')
          ? { count: 0 }
          : [],
    });
  });
  await page.goto('/delivery-operations');
  return { requests, state, mutations };
}
test('read-only cockpit keeps source totals and routes explicit next actions', async ({ page }) => {
  const { requests } = await setup(page);
  await expect(page.getByRole('heading', { name: 'Exploitation livraison' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Chargement LD-8042' })).toContainText(
    '7 colis déclarés',
  );
  await expect(
    page.getByText('41 chargements correspondent au filtre · 1 sur cette page'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Examiner les incidents' })).toHaveAttribute(
    'href',
    '/loads/load-1',
  );
  await expect(page.getByText('1 retour à recevoir')).toBeVisible();
  await expect(page.getByText('1 retour reçu')).toBeVisible();
  expect(requests.every((r) => r.method === 'GET')).toBe(true);
});
test('server pagination, filters and submitted search remain explicit', async ({ page }) => {
  const { requests } = await setup(page);
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByRole('heading', { name: 'LD-8038' })).toBeVisible();
  expect(requests.at(-1)?.page).toBe('2');
  await page.getByLabel('Dossiers à examiner').selectOption('returns');
  await expect(page.getByText('Page 1 sur 3')).toBeVisible();
  expect(requests.at(-1)?.filter).toBe('returns');
  await page.getByLabel('Numéro de chargement').fill('LD-8042');
  await page.getByRole('button', { name: 'Rechercher', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.search).toBe('LD-8042');
  expect(requests.every((r) => r.method === 'GET')).toBe(true);
});
test('access loss does not query the cockpit API', async ({ page }) => {
  const { requests } = await setup(page, false);
  await expect(
    page.getByText('Transport activé et droit de lecture de la planification requis.'),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
});
test('mobile empty/error states and explicit refresh without horizontal overflow', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state } = await setup(page);
  await expect(page.getByRole('heading', { name: 'LD-8042' })).toBeVisible();
  expect(
    await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('delivery-operations-mobile.png'),
    animations: 'disabled',
  });
  state.fail = true;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByText('Lecture indisponible, réessayez.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'LD-8042' })).toHaveCount(0);
  state.fail = false;
  state.empty = true;
  await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
  await expect(page.getByText('Aucun dossier dans cette vue')).toBeVisible();
});

test('agent analysis prepares a draft without sending a message or mutation', async ({ page }) => {
  const { mutations } = await setup(page, true, true);
  await page.getByRole('button', { name: 'Analyser avec un agent' }).click();
  await expect(page.getByRole('textbox', { name: 'Message au worker' })).toHaveValue(
    /list_delivery_operations[\s\S]*get_delivery_context/,
  );
  expect(mutations).toHaveLength(0);
});
