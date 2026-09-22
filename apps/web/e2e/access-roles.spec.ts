import { test, expect, type Page } from './fixtures';
import { login } from './helpers';

test.beforeEach(({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

async function setAuthOverrides(page: Page, permissions: string[], enabledModules: string[]) {
  await page.evaluate(
    ({ permissions, enabledModules }) => {
      const s = JSON.parse(localStorage.getItem('pulsar.auth')!);
      s.user.permissions = permissions;
      s.tenant.enabledModules = enabledModules;
      localStorage.setItem('pulsar.auth', JSON.stringify(s));
    },
    { permissions, enabledModules },
  );
}

const permission = (id: string, key: string, module: string, description: string) => ({
  id,
  key,
  module,
  description,
});

const PERMISSIONS_MOCK = [
  permission('p-core-1', 'core.users.read', 'core', 'Consulter les utilisateurs'),
  permission('p-core-2', 'core.users.manage', 'core', 'Gérer les utilisateurs'),
  permission('p-core-3', 'core.roles.read', 'core', 'Consulter les rôles'),
  permission('p-core-4', 'core.roles.manage', 'core', 'Gérer les rôles'),
  permission('p-wms-1', 'wms.read', 'wms', "Consulter l'entrepôt"),
  permission('p-wms-2', 'wms.manage', 'wms', "Gérer l'entrepôt"),
  permission('p-tms-1', 'transportation.loads.read', 'transportation', 'Consulter les chargements'),
  permission('p-tms-2', 'transportation.loads.manage', 'transportation', 'Gérer les chargements'),
];

const ROLES_MOCK = [
  {
    id: 'r-admin',
    key: 'admin',
    name: 'Administrateur',
    description: 'Rôle système complet',
    isSystem: true,
    permissions: [],
    _count: { users: 2 },
  },
  {
    id: 'r-dispatcher',
    key: 'dispatcher',
    name: 'Répartiteur',
    description: 'Rôle personnalisé',
    isSystem: false,
    permissions: [
      {
        permission: {
          id: 'p-wms-1',
          key: 'wms.read',
          module: 'wms',
          description: "Consulter l'entrepôt",
        },
      },
    ],
    _count: { users: 1 },
  },
];

const TEMPLATES_MOCK = [
  {
    key: 'viewer',
    name: 'Lecture seule',
    description: 'Consultation uniquement, aucune écriture.',
    module: null,
    permissionKeys: ['core.users.read'],
    exists: false,
  },
];

async function mockRolesEndpoints(page: Page) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  await page.route('**/api/v1/roles**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v1/roles', '') || '/';
    if (req.method() === 'GET' && path === '/templates') {
      return route.fulfill({ json: TEMPLATES_MOCK });
    }
    if (req.method() === 'GET' && path === '/') {
      return route.fulfill({ json: ROLES_MOCK });
    }
    if (req.method() === 'POST' && path === '/from-template') {
      writes.push({ path, method: req.method(), body: req.postDataJSON() });
      return route.fulfill({
        status: 201,
        json: {
          id: 'r-new',
          key: 'viewer',
          name: 'Lecture seule',
          description: 'Consultation uniquement, aucune écriture.',
          isSystem: false,
          permissions: [],
          _count: { users: 0 },
        },
      });
    }
    return route.fulfill({ status: 404, json: { message: `Unexpected ${req.method()} ${path}` } });
  });
  await page.route('**/api/v1/permissions**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: PERMISSIONS_MOCK });
  });
  return writes;
}

test('roles page renders permission groups only for the platform and enabled modules', async ({
  page,
}) => {
  await login(page);
  await setAuthOverrides(page, ['core.roles.read', 'core.roles.manage'], ['wms']);
  await mockRolesEndpoints(page);
  await page.goto('/settings/roles');
  await expect(page.getByRole('button', { name: 'Créer un rôle' })).toBeVisible();
  await page.getByRole('button', { name: 'Créer un rôle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Créer un rôle' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Plateforme', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Entrepôt', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Transport', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('core.roles.manage', { exact: true })).toBeVisible();
  await expect(dialog.getByText('wms.read', { exact: true })).toBeVisible();
  await expect(dialog.getByText('transportation.loads.read', { exact: true })).toHaveCount(0);
});

test('creating a role from a template posts the template key', async ({ page }) => {
  await login(page);
  await setAuthOverrides(page, ['core.roles.read', 'core.roles.manage'], ['wms']);
  const writes = await mockRolesEndpoints(page);
  await page.goto('/settings/roles');
  await expect(page.getByRole('heading', { name: 'Rôles suggérés' })).toBeVisible();
  // The card must disclose what the template actually grants before it is applied.
  const details = page.getByText('1 permissions', { exact: true });
  await expect(details).toBeVisible();
  await expect(page.getByText('core.users.read', { exact: true })).toBeHidden();
  await details.click();
  await expect(page.getByText('core.users.read', { exact: true })).toBeVisible();
  const [request] = await Promise.all([
    page.waitForRequest(
      (r) => r.url().includes('/api/v1/roles/from-template') && r.method() === 'POST',
    ),
    page.getByRole('button', { name: 'Créer ce rôle' }).click(),
  ]);
  expect(request.postDataJSON()).toEqual({ templateKey: 'viewer' });
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toEqual({ templateKey: 'viewer' });
});

async function mockEmptyWmsSites(page: Page) {
  await page.route('**/api/v1/wms/sites**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
  });
}

test('warehouse creation shortcut is gated on core.locations.manage', async ({ page }) => {
  await login(page);
  await mockEmptyWmsSites(page);

  await setAuthOverrides(page, ['wms.read', 'wms.manage', 'core.locations.manage'], ['wms']);
  await page.goto('/wms');
  await expect(page.getByText('Aucun entrepôt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Créer un entrepôt' })).toBeVisible();
  await expect(page.getByText('Demandez à un administrateur')).toHaveCount(0);

  await setAuthOverrides(page, ['wms.read', 'wms.manage'], ['wms']);
  await page.goto('/wms');
  await expect(page.getByText('Aucun entrepôt')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Créer un entrepôt' })).toHaveCount(0);
  await expect(page.getByText('Demandez à un administrateur', { exact: false })).toBeVisible();
});
