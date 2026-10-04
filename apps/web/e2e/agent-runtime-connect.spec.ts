import { test, expect, type Page } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';

async function setup(
  page: Page,
  mode: 'success' | 'incomplete' | 'pending' | 'unavailable' | 'changed' = 'success',
) {
  await page.addInitScript(() =>
    localStorage.setItem(
      'pulsar.auth',
      JSON.stringify({
        accessToken: 'fixture-token',
        refreshToken: 'fixture-refresh',
        user: {
          id: 'fixture',
          firstName: 'Test',
          lastName: 'IA',
          email: 'test@example.invalid',
          permissions: ['core.agents.read', 'core.agents.manage'],
        },
        tenant: { id: 'fixture', slug: 'fixture', name: 'Test IA', enabledModules: [] },
      }),
    ),
  );
  const calls: string[] = [];
  const config = {
    installed: mode !== 'unavailable',
    runtimeMode: 'remote',
    configured: true,
    provider: 'openai-codex',
    authMode: 'login',
    defaultModel: 'fixture-model',
    connectedAt: null as string | null,
  };
  let release: (() => void) | undefined;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') calls.push(path);
    if (path.endsWith('/agent-runtime/connect')) {
      if (mode === 'pending')
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (mode === 'success' || mode === 'changed') config.connectedAt = '2026-10-02T19:00:00Z';
      if (mode === 'changed') config.defaultModel = 'changed-by-another-admin';
      return route.fulfill({
        contentType: 'text/event-stream',
        body:
          'event: status\ndata: {"phase":"STARTING","message":"Préparation du runner"}\n\n' +
          'event: text\ndata: {"text":"Ouvrez https://auth.open"}\n\n' +
          'event: text\ndata: {"text":"ai.com/codex/device\\nCode de test : FIX"}\n\n' +
          'event: text\ndata: {"text":"TURE-ONLY"}\n\n' +
          (mode === 'success' || mode === 'changed' ? 'event: end\ndata: {}\n\n' : ''),
      });
    }
    return route.fulfill({
      json: path.endsWith('/agent-runtime/providers')
        ? [
            {
              id: 'openai-codex',
              label: 'OpenAI Codex',
              authMode: 'login',
              loginCommand: 'auth add openai-codex',
            },
          ]
        : path.endsWith('/agent-runtime/health')
          ? {
              installed: config.installed,
              runtimeMode: 'remote',
              runnerStatus: config.installed ? 'ready' : 'unassigned',
              assessment: config.installed ? 'reference-match' : 'not-installed',
              installedVersion: '0.16.0',
              checkedAt: '2026-10-02T19:00:00Z',
              reference: {
                version: '0.16.0',
                upstreamVersion: '0.21.5',
                upstreamCheckedAt: '2026-09-27',
                upstreamUrl: 'https://example.invalid',
              },
            }
          : path.endsWith('/agent-runtime/test')
            ? {
                ok: true,
                scope: 'RUNTIME_ONLY',
                models: [{ value: 'fixture-model', label: 'Fixture model' }],
              }
            : path.endsWith('/agent-runtime')
              ? config
              : path.endsWith('/preferences')
                ? EXPERIENCED_PREFERENCES
                : path.endsWith('/unseen-count')
                  ? { count: 0 }
                  : [],
    });
  });
  await page.goto('/settings/agent-runtime');
  await expect(page.getByRole('heading', { name: 'Connexion IA', exact: true })).toBeVisible();
  await expect(page.getByLabel('Fournisseur du modèle')).toHaveValue('openai-codex');
  return { calls, release: () => release?.() };
}

test('Codex account connection stays distinct from runtime and inference; no automatic mission', async ({
  page,
}, info) => {
  const { calls } = await setup(page);
  await expect(page.getByText('pnpm agents:setup', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connecter OpenAI Codex', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Compte connecté.' })).toBeVisible();
  expect(calls).toEqual(['/api/v1/agent-runtime/connect']);
  await page.getByRole('button', { name: 'Vérifier le runtime', exact: true }).click();
  await expect(
    page.getByText('Session runtime ouverte — inférence non testée', { exact: true }),
  ).toBeVisible();
  expect(calls).toEqual(['/api/v1/agent-runtime/connect', '/api/v1/agent-runtime/test']);
  await expect(
    page.getByRole('link', { name: 'Tous les champs de connexion et leur diagnostic' }),
  ).toHaveAttribute('href', '/documentation?view=fields&topic=ai-connection');
  await page.screenshot({ path: info.outputPath('codex-connection-desktop.png'), fullPage: true });
});

test('an interrupted device stream stops visibly and does not mark account connected', async ({
  page,
}, info) => {
  const { calls } = await setup(page, 'incomplete');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Connecter OpenAI Codex', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'sans confirmation' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connecter OpenAI Codex', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText('Dernière connexion enregistrée', { exact: true })).toHaveCount(0);
  await page.getByText('Instructions du fournisseur — confidentielles', { exact: true }).click();
  await expect(page.locator('pre')).toContainText('https://auth.openai.com/codex/device');
  await expect(page.locator('pre')).toContainText('FIXTURE-ONLY');
  expect(calls).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: info.outputPath('codex-connection-mobile-error.png'),
    fullPage: true,
  });
});

test('an in-flight login can be cancelled, keeping fields locked until it stops', async ({
  page,
}) => {
  const state = await setup(page, 'pending');
  await page.getByRole('button', { name: 'Connecter OpenAI Codex', exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  await expect(page.getByLabel('Fournisseur du modèle')).toBeDisabled();
  await expect(page.getByLabel('Modèle (optionnel)')).toBeDisabled();
  await page.getByRole('button', { name: 'Annuler la tentative' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tentative arrêtée' })).toBeVisible();
  await expect(page.getByLabel('Fournisseur du modèle')).toBeEnabled();
  state.release();
  expect(state.calls).toHaveLength(1);
  await page.goto('about:blank');
});

test('an unassigned runner cannot start a misleading OAuth wait', async ({ page }) => {
  const { calls } = await setup(page, 'unavailable');
  await expect(
    page.getByRole('button', { name: 'Connecter OpenAI Codex', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/Aucun runner valide rattaché/)).toBeVisible();
  expect(calls).toHaveLength(0);
});

test('another administrator changing the connection context is not presented as our login success', async ({
  page,
}) => {
  await setup(page, 'changed');
  await page.getByRole('button', { name: 'Connecter OpenAI Codex', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'configuration IA a changé' }),
  ).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Compte connecté.' })).toHaveCount(0);
});
