import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';

test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});

async function setup(
  page: Page,
  permissions = [
    'transportation.orders.read',
    'transportation.planning.read',
    'transportation.execution.read',
    'core.agents.read',
    'core.agents.manage',
    'core.email.send',
  ],
  modules = ['transportation'],
) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ permissions, modules }) => {
      if (!/^https?:$/.test(location.protocol)) return;
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
            permissions,
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
    { permissions, modules },
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

test('dictionary advertises its real coverage and never sends a business request', async ({
  page,
}) => {
  const writes = await setup(page);
  await page.goto('/documentation?view=fields');
  const dictionary = page.getByRole('article', { name: 'Dictionnaire des champs' });
  await expect(dictionary.getByTestId('field-coverage')).toContainText(
    'leur dictionnaire au champ près reste à enrichir',
  );
  await expect(
    dictionary.getByRole('navigation', { name: 'Sujets du dictionnaire' }).getByRole('link'),
  ).toHaveCount(1);
  await expect(dictionary).toContainText('13 sujets · 150 champs et contrôles');
  await expect(dictionary.getByRole('link', { name: /Colis de livraison/ })).toHaveCount(1);
  expect(writes).toEqual([]);
});

test('connected distribution documents all five topics and keeps full coverage scoped to access', async ({
  page,
}) => {
  const writes = await setup(
    page,
    [
      'transportation.orders.read',
      'transportation.planning.read',
      'transportation.execution.read',
      'core.agents.read',
      'core.agents.manage',
      'manufacturing.read',
      'wms.read',
      'crm.read',
    ],
    ['transportation', 'manufacturing', 'wms', 'crm'],
  );
  await page.goto('/documentation?view=fields');
  const dictionary = page.getByRole('article', { name: 'Dictionnaire des champs' });
  await expect(dictionary).toContainText('332 champs et contrôles');
  for (const [topic, field, rule] of [
    ['delivery-incidents', 'receivedBy', 'utilisateur confirmant actif et non agent'],
    [
      'delivery-source-allocation',
      'salesUnitAcknowledged',
      '1 pièce commerciale = 1 pièce du colis',
    ],
    ['delivery-fuel-profiles', 'measuredAt', 'Distinct de la date de saisie serveur'],
    ['driver-shareable-document', 'confirmDriverPublication', 'humain actif'],
    ['delivery-cockpit', 'plan_delivery_retry', 'gouvernance'],
  ]) {
    await page.goto(`/documentation?view=fields&topic=${topic}`);
    const detail = page.locator(`details[data-field="${field}"]`);
    await detail.locator('summary').click();
    await expect(detail).toContainText(rule);
    await expect(dictionary.getByRole('link', { name: 'Ouvrir l’écran' })).toHaveAttribute(
      'href',
      topic === 'delivery-cockpit' ? '/delivery-operations' : '/loads',
    );
  }
  expect(writes).toEqual([]);
});

test('field search understands accents and opens the exact quantity rules', async ({ page }) => {
  await setup(page);
  await page.goto('/documentation?view=fields&topic=delivery-packages');
  await page
    .getByRole('textbox', { name: 'Rechercher dans la documentation' })
    .fill('QUANTITE exact');
  const quantity = page.locator('details[data-field="contents.quantity"]');
  await quantity.locator('summary').click();
  await expect(quantity).toContainText('maximum 12 chiffres avant le point et 3 après');
  await expect(quantity).toContainText('aucune déduction de stock');
  await expect(quantity).toContainText('12.500 est normalisé en 12.5');
  await expect(page.locator('details[data-field="recipientName"]')).toHaveCount(0);
});

test('model connection differentiates key, account, runtime and inference', async ({ page }) => {
  await setup(page);
  await page.goto('/documentation?view=fields&topic=ai-connection');
  await page.locator('details[data-field="apiKey"] summary').click();
  await expect(page.locator('details[data-field="apiKey"]')).toContainText('Stockée chiffrée');
  await page.locator('details[data-field="runtimeStatus"] summary').click();
  await expect(page.locator('details[data-field="runtimeStatus"]')).toContainText(
    'ne prouve pas qu’une inférence',
  );
  await expect(page.getByRole('link', { name: 'Ouvrir l’écran' })).toHaveAttribute(
    'href',
    '/settings/agent-runtime',
  );
});

test('existing agent read access does not reveal connection management via search or deep link', async ({
  page,
}) => {
  await setup(page, ['core.agents.read'], []);
  await page.goto('/documentation?view=fields');
  await expect(
    page.getByRole('navigation', { name: 'Sujets du dictionnaire' }).getByRole('link'),
  ).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Rechercher dans la documentation' }).fill('baseUrl');
  await expect(page.getByRole('link', { name: 'Connexion IA et modèle', exact: true })).toHaveCount(
    0,
  );
  await page.goto('/documentation?view=fields&topic=ai-connection');
  await expect(page.getByRole('heading', { name: 'Sujet non accessible' })).toBeVisible();
  await expect(page.locator('[data-field]')).toHaveCount(0);
});

test('disabled transport module hides its dictionary even when permission strings remain', async ({
  page,
}) => {
  await setup(page, ['core.agents.read', 'transportation.planning.read'], []);
  await page.goto('/documentation?view=fields&topic=route-fuel');
  await expect(page.getByRole('heading', { name: 'Sujet non accessible' })).toBeVisible();
  await expect(page.getByText('Consommation chargé', { exact: true })).toHaveCount(0);
});

test('AI examples are real and gated independently from roster access', async ({ page }) => {
  const writes = await setup(page, ['core.agents.read', 'core.email.send'], []);
  await page.goto('/documentation?view=fields&topic=ai-workers');
  const examples = page.getByRole('region', { name: 'Exemples d’utilité IA' });
  await expect(
    examples.getByRole('heading', { name: 'Préparer un courriel sans l’envoyer' }),
  ).toBeVisible();
  await expect(examples).toContainText('draft_email');
  await expect(examples).toContainText('ne persiste pas et n’envoie pas');
  await expect(
    examples.getByRole('heading', { name: 'Relire une tournée avant départ' }),
  ).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('search has an explicit empty state without losing the current topic', async ({ page }) => {
  await setup(page);
  await page.goto('/documentation?view=fields&topic=delivery-manifests');
  await page
    .getByRole('textbox', { name: 'Rechercher dans la documentation' })
    .fill('zzzznotafield');
  await expect(
    page.getByText('Aucun champ de ce sujet ne correspond.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Manifestes et étiquettes', exact: true }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Rechercher dans la documentation' }).fill('');
  await expect(page.locator('details[data-field="reason"]')).toBeVisible();
});

test('mobile dictionary retains legible field detail and no horizontal overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/documentation?view=fields&topic=delivery-packages');
  await page
    .getByRole('textbox', { name: 'Rechercher dans la documentation' })
    .fill('contents.quantity');
  await page.locator('details[data-field="contents.quantity"] summary').click();
  await page.locator('details[data-field="contents.quantity"]').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('details[data-field="contents.quantity"]')).toContainText(
    'Requis et conditions',
  );
  await page.screenshot({
    path: testInfo.outputPath('documentation-fields-mobile.png'),
    fullPage: true,
  });
});
