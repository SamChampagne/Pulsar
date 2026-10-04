import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';

const permissions = [
  'manufacturing.read',
  'wms.read',
  'crm.read',
  'transportation.planning.read',
  'core.agents.read',
  'core.agents.chat',
  'core.agents.actions.read',
  'core.operating.tasks.read',
];
async function setup(
  page: Page,
  modules = ['manufacturing', 'wms', 'crm', 'transportation'],
  rights = permissions,
) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ modules, rights }) => {
      if (!/^https?:$/.test(location.protocol) || localStorage.getItem('pulsar.auth')) return;
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'fixture-token',
          refreshToken: 'fixture-refresh',
          user: {
            id: 'documentation-reader',
            firstName: 'Camille',
            lastName: 'Recette',
            email: 'fixture@example.invalid',
            permissions: rights,
          },
          tenant: {
            id: 'fixture',
            name: 'Entreprise de recette',
            slug: 'fixture',
            enabledModules: modules,
          },
        }),
      );
    },
    { modules, rights },
  );
  const writes: string[] = [];
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    return route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/preferences')
        ? EXPERIENCED_PREFERENCES
        : [],
    });
  });
  return writes;
}
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});

test('dictionary filters its real topics by application without adding business writes', async ({
  page,
}, testInfo) => {
  const writes = await setup(page);
  await page.goto('/documentation?view=fields');
  await page
    .getByRole('combobox', { name: 'Application du dictionnaire' })
    .selectOption('manufacturing');
  await expect(page).toHaveURL(/domain=manufacturing/);
  const dictionary = page.getByRole('article', { name: 'Dictionnaire des champs' });
  await expect(
    dictionary.getByRole('link', { name: /Fabrication · sites, calendriers et postes/ }).first(),
  ).toBeVisible();
  await expect(dictionary.getByRole('link', { name: /Colis de livraison/ })).toHaveCount(0);
  await dictionary
    .getByRole('link', { name: /Fabrication · sites, calendriers et postes/ })
    .first()
    .click();
  await page.locator('details[data-field="workCenter.efficiency"] summary').click();
  await expect(page.locator('details[data-field="workCenter.efficiency"]')).toContainText('0.85');
  await page.locator('details[data-field="workCenter.efficiency"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('manufacturing-field-desktop.png') });
  expect(writes).toEqual([]);
});

test('manufacturing-only keeps resources while material deep links require WMS', async ({
  page,
}) => {
  await setup(page, ['manufacturing']);
  await page.goto('/documentation?view=fields&topic=manufacturing-mrp');
  await expect(page.getByRole('heading', { name: 'Sujet non accessible' })).toBeVisible();
  await expect(page.locator('[data-field]')).toHaveCount(0);
  await page.goto('/documentation?view=fields&topic=manufacturing-resources');
  await expect(page.locator('[data-field="calendar.code"]')).toBeVisible();
  await expect(
    page
      .getByRole('combobox', { name: 'Application du dictionnaire' })
      .locator('option[value="wms"]'),
  ).toHaveCount(0);
});

test('WMS remains autonomous without transportation or manufacturing', async ({ page }) => {
  await setup(page, ['wms'], ['wms.read']);
  await page.goto('/documentation?view=fields&domain=wms');
  const dictionary = page.getByRole('article', { name: 'Dictionnaire des champs' });
  await expect(
    dictionary.getByRole('combobox', { name: 'Application du dictionnaire' }),
  ).toHaveValue('wms');
  await expect(
    dictionary.getByRole('navigation', { name: 'Sujets du dictionnaire' }).getByRole('link'),
  ).toHaveCount(9);
  await expect(dictionary.getByRole('link', { name: /Fabrication/ })).toHaveCount(0);
});

test('AI pilot is a local manual checklist and never starts a business operation', async ({
  page,
}) => {
  const writes = await setup(page);
  await page.goto('/documentation?view=ai-pilot&pilot=transport-predeparture');
  const pilot = page.getByRole('article', { name: 'Parcours pilote IA' });
  await expect(pilot.getByTestId('pilot-boundary')).toContainText('Aucun appel au modèle');
  await expect(pilot.getByRole('textbox', { name: 'Consigne du pilote' })).toHaveValue(
    /assign_shipment/,
  );
  await expect(pilot.getByRole('textbox', { name: 'Consigne du pilote' })).toHaveValue(
    /capacityChecked/,
  );
  await pilot.getByRole('checkbox').first().check();
  await expect(pilot.getByRole('checkbox').first()).toBeChecked();
  await expect(pilot.getByText(/1\/6 étapes cochées manuellement/)).toBeVisible();
  await expect(pilot.getByRole('link', { name: 'Vérifier la connexion IA' })).toHaveCount(0);
  await expect(
    pilot.getByRole('link', { name: 'Voir les propositions', exact: true }),
  ).toHaveAttribute('href', '/agent-actions');
  await pilot.getByRole('link', { name: /MRP/ }).click();
  await expect(pilot.getByRole('checkbox').first()).not.toBeChecked();
  await expect(
    pilot.getByText('Coller ce texte dans un chat ne crée pas', { exact: false }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test('pilot copy failure leaves the prompt readable with no request or silent retry', async ({
  page,
}) => {
  const writes = await setup(page);
  await page.goto('/documentation?view=ai-pilot&pilot=transport-predeparture');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    }),
  );
  await page.getByRole('button', { name: 'Copier la consigne' }).click();
  await expect(page.getByText('Copie indisponible.', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Consigne du pilote' })).toHaveValue(/loadId/);
  expect(writes).toEqual([]);
});

test('losing and restoring the session access clears pilot checks with production-compatible navigation', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/documentation?view=ai-pilot&pilot=transport-predeparture');
  await page.getByRole('checkbox').first().check();
  const initialSession = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('pulsar.auth')!);
    localStorage.setItem(
      'pulsar.auth',
      JSON.stringify({ ...session, tenant: { ...session.tenant, enabledModules: [] } }),
    );
    return session;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Parcours non accessible' })).toBeVisible();
  await page.evaluate(
    (session) => localStorage.setItem('pulsar.auth', JSON.stringify(session)),
    initialSession,
  );
  await page.reload();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
});

test('pilot gates operator access separately from the agent business permissions', async ({
  page,
}) => {
  await setup(page, ['transportation'], ['core.agents.read', 'transportation.planning.read']);
  await page.goto('/documentation?view=ai-pilot&pilot=transport-predeparture');
  await expect(page.getByRole('heading', { name: 'Parcours non accessible' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Consigne du pilote' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('MRP pilot never appears without active WMS even with retained rights', async ({ page }) => {
  await setup(page, ['manufacturing', 'transportation']);
  await page.goto('/documentation?view=ai-pilot&pilot=mrp-assigned-review');
  await expect(page.getByRole('heading', { name: 'Parcours non accessible' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Consigne du pilote' })).toHaveCount(0);
});

test('pilot is usable on mobile with readable prompt and no overflow', async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/documentation?view=ai-pilot&pilot=transport-predeparture');
  await page.getByRole('button', { name: 'Copier la consigne' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('textbox', { name: 'Consigne du pilote' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ai-pilot-mobile.png') });
});
