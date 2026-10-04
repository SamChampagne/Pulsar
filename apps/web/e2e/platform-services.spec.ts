import { test, expect, type Page } from './fixtures';

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('pulsar_platform_token', 'platform-fixture'));
  const email = {
    mode: 'ENVIRONMENT',
    host: '',
    port: 587,
    secure: false,
    username: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    hasPassword: false,
    updatedAt: null as string | null,
  };
  const tenants = [
    { id: 'alpha', name: 'Atelier du Nord', slug: 'atelier', status: 'ACTIVE' },
    { id: 'beta', name: 'Services Rivage', slug: 'rivage', status: 'SUSPENDED' },
  ];
  const runtime: Record<string, any> = {
    provider: 'openrouter',
    defaultModel: 'fixture-model',
    hasApiKey: true,
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
  const writes: { path: string; body: any; authorization: string | undefined }[] = [];
  const state = { conflict: false };
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() !== 'GET')
      writes.push({ path, body: req.postDataJSON(), authorization: req.headers().authorization });
    if (path === '/api/v1/platform/services')
      return route.fulfill({
        json: {
          email,
          emailChannel: email.mode === 'SMTP' ? 'smtp' : 'log',
          tenants,
          audit: [],
          tenantLimit: 500,
        },
      });
    if (path === '/api/v1/platform/services/email' && req.method() === 'PUT') {
      if (state.conflict)
        return route.fulfill({
          status: 409,
          json: { message: 'La configuration a changé. Rechargez avant de sauvegarder.' },
        });
      const { password, confirmed, expectedUpdatedAt, ...values } = req.postDataJSON();
      Object.assign(email, values, {
        hasPassword: !!password,
        updatedAt: '2026-10-01T11:00:00.000Z',
      });
      return route.fulfill({ json: email });
    }
    if (path.endsWith('/verify'))
      return route.fulfill({
        json: {
          ok: true,
          message: path.includes('/runtime/')
            ? 'Protocole runtime vérifié. Aucun appel LLM effectué.'
            : 'Connexion SMTP et authentification vérifiées. Aucun courriel envoyé; livraison non vérifiée.',
        },
      });
    if (path.endsWith('/runtime/connect'))
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'event: status\ndata: {"phase":"STARTING","message":"Préparation du runner"}\n\nevent: text\ndata: {"text":"Ouvrez le portail du fournisseur et confirmez le co"}\n\nevent: text\ndata: {"text":"de de test."}\n\nevent: end\ndata: {}\n\n',
      });
    if (path.endsWith('/runtime') && req.method() === 'PUT') {
      Object.assign(runtime, req.postDataJSON(), { updatedAt: '2026-10-01T12:00:00.000Z' });
      delete runtime.apiKey;
      return route.fulfill({ json: runtime });
    }
    const tenant = tenants.find((t) => path === `/api/v1/platform/services/tenants/${t.id}`);
    if (tenant)
      return route.fulfill({
        json: {
          tenant,
          runtime: tenant.id === 'alpha' ? runtime : {},
          health: {
            installed: tenant.id === 'alpha',
            runtimeMode: 'remote',
            runnerStatus: tenant.id === 'alpha' ? 'ready' : 'unassigned',
            runnerActiveProcesses: 1,
            runnerMaxConcurrent: 4,
            installedVersion: '0.16.0',
            assessment: 'reference-match',
            checkedAt: '2026-10-01T10:00:00Z',
          },
          email: { outbound: 'log', inbound: 'log', config: null },
          sms: null,
        },
      });
    return route.fulfill({ status: 404, json: { message: `Unexpected route ${path}` } });
  });
  await page.goto('/platform/services');
  await expect(
    page.getByRole('heading', { name: 'Services et connexions', exact: true }),
  ).toBeVisible();
  return { writes, state };
}

test('SMTP global: explicit scope, dirty check, masked secret, no send during verification', async ({
  page,
}, info) => {
  const { writes } = await setup(page);
  await expect(page.locator('span').filter({ hasText: /^●\s*Simulation$/ })).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole('combobox', { name: 'Transport sortant', exact: true }).selectOption('SMTP');
  await page.getByLabel('Préremplir un fournisseur').selectOption('ovh-ca');
  await page.getByLabel('Identifiant SMTP').fill('noreply@example.test');
  await page.getByLabel('Mot de passe ou mot de passe d’application').fill('fixture-password');
  await page.getByLabel('Adresse de l’expéditeur', { exact: true }).fill('noreply@example.test');
  await expect(page.getByRole('button', { name: 'Enregistrer le courriel' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Vérifier SMTP sans envoyer' })).toBeDisabled();
  await page.getByLabel('Je confirme la portée').check();
  await page.getByRole('button', { name: 'Enregistrer le courriel' }).click();
  await expect(page.getByText('SMTP réel configuré')).toBeVisible();
  await expect(page.getByLabel('Mot de passe ou mot de passe d’application')).toHaveValue('');
  expect(writes[0]).toMatchObject({
    authorization: 'Bearer platform-fixture',
    body: {
      mode: 'SMTP',
      host: 'smtp.mail.ovh.ca',
      secure: true,
      password: 'fixture-password',
      confirmed: true,
      expectedUpdatedAt: null,
    },
  });
  await page.getByRole('button', { name: 'Vérifier SMTP sans envoyer' }).click();
  await expect(page.getByRole('status')).toContainText('Aucun courriel envoyé');
  expect(writes).toHaveLength(2);
  expect(writes[1].body).not.toHaveProperty('to');
  await page.locator('main').evaluate((el) => el.scrollTo({ top: 0 }));
  await page.screenshot({ path: info.outputPath('services-desktop.png'), fullPage: true });
});

test('a stale SMTP save stays explicit, retains input and is never retried automatically', async ({
  page,
}) => {
  const { writes, state } = await setup(page);
  state.conflict = true;
  await page
    .getByRole('combobox', { name: 'Transport sortant', exact: true })
    .selectOption('SIMULATION');
  await page.getByLabel('Je confirme la portée').check();
  await page.getByRole('button', { name: 'Enregistrer le courriel' }).click();
  await expect(
    page.getByText('La configuration a changé. Rechargez avant de sauvegarder.', { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  await expect(page.getByRole('combobox', { name: 'Transport sortant', exact: true })).toHaveValue(
    'SIMULATION',
  );
});

test('tenant runner diagnostics, governed configuration and OAuth use only platform endpoints', async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page.getByRole('button', { name: 'Connexions entreprises', exact: true }).click();
  await page.getByLabel('Entreprise à administrer').selectOption('alpha');
  await expect(page.getByText('Runtime joignable', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByLabel('Fournisseur IA').selectOption('openai-codex');
  await expect(page.getByRole('button', { name: 'Connecter le compte' })).toBeDisabled();
  await page.getByLabel('Modèle par défaut').fill('fixture-codex');
  await page.getByLabel('Je suis autorisé à configurer l’IA').check();
  await page.getByRole('button', { name: 'Enregistrer l’IA' }).click();
  await expect(
    page.getByText('Connexion IA enregistrée pour cette entreprise.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connecter le compte' }).click();
  await expect(page.locator('pre')).toContainText('code de test');
  expect(writes).toHaveLength(2);
  expect(
    writes.every(
      (w) =>
        w.path.includes('/platform/services/tenants/alpha/runtime') &&
        w.authorization === 'Bearer platform-fixture',
    ),
  ).toBe(true);
  expect(writes[0].body).not.toHaveProperty('apiKey');
  await page.getByLabel('Entreprise à administrer').selectOption('beta');
  await expect(page.getByText('Runner non rattaché', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enregistrer l’IA' })).toBeDisabled();
  await expect(page.getByLabel('Modèle par défaut')).toHaveValue('');
});

test('mobile setup remains readable, with no fake install or enable-all action', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes } = await setup(page);
  await page.getByRole('button', { name: 'Mise en place serveur', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ce qui reste du ressort du serveur' }),
  ).toBeVisible();
  await expect(page.getByText('Runner IA par entreprise', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(writes).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('services-mobile.png'), fullPage: true });
});
