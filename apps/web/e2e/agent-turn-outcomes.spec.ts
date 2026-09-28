import { test, expect } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';

test.use({ reducedMotion: 'reduce' });

for (const status of ['failed', 'cancelled', 'succeeded'] as const) {
  test(`chat renders ${status} honestly (synthetic runtime)`, async ({ page }, info) => {
    // UI fixture only: auth and every API request are synthetic. No database,
    // provider, business action or worker is touched by this browser test.
    await page.addInitScript(() =>
      localStorage.setItem(
        'pulsar.auth',
        JSON.stringify({
          accessToken: 'fixture-token',
          refreshToken: 'fixture-refresh',
          user: {
            id: 'fixture-user',
            firstName: 'Camille',
            lastName: 'Recette',
            email: 'fixture@example.invalid',
            permissions: ['core.agents.read', 'core.agents.manage', 'core.agents.chat'],
          },
          tenant: { id: 'fixture-tenant', slug: 'fixture', name: 'Recette IA', enabledModules: [] },
        }),
      ),
    );
    await page.route('**/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        json: path.endsWith('/preferences')
          ? EXPERIENCED_PREFERENCES
          : path.endsWith('/unseen-count')
            ? { count: 0 }
            : [],
      });
    });
    await page.route('**/api/v1/agents/outcome-fixture**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = path.endsWith('/activity')
        ? {
            conversations: [],
            proposedActions: [],
            stats: { conversations: 0, pending: 0, executed: 0, rejected: 0 },
          }
        : path.endsWith('/runs')
          ? { items: [], total: 0, page: 1, pageSize: 20 }
          : path.endsWith('/timeline')
            ? []
            : path.endsWith('/trust') || path.endsWith('/kpis')
              ? null
              : {
                  id: 'outcome-fixture',
                  name: 'Agent de recette',
                  status: 'ACTIVE',
                  model: 'fixture',
                  persona: null,
                  permissions: [],
                  caps: {},
                  autonomyLevel: 'PROPOSE',
                  createdAt: '2026-09-28T12:00:00Z',
                  prefix: 'fixture',
                };
      return route.fulfill({ json });
    });
    await page.route('**/api/v1/agent-runtime**', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/v1/agent-conversations', (route) =>
      route.fulfill({ json: { id: 'outcome-conversation' } }),
    );
    await page.route('**/api/v1/agent-conversations/outcome-conversation/messages', (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: [
          'event: text\ndata: {"text":"Réponse synthétique de recette."}\n\n',
          `event: result\ndata: ${JSON.stringify({ result: { version: 1, status, usage: { scope: 'runtime_session', inputTokens: 10, outputTokens: 2, totalTokens: 12 } } })}\n\n`,
          'event: end\ndata: {}\n\n',
        ].join(''),
      }),
    );
    await page.goto('/agents/outcome-fixture');
    const input = page.getByPlaceholder('Envoyer un message…');
    await input.fill('Résume le dossier de recette.');
    await input.press('Enter');
    await expect(page.getByText('Réponse synthétique de recette.', { exact: true })).toBeVisible();
    if (status === 'succeeded') {
      await expect(page.getByText(/Réponse non validée$/)).toHaveCount(0);
      await expect(page.getByText(/12 tokens cumulés/)).toBeVisible();
    } else {
      await expect(
        page.getByText(status === 'cancelled' ? /Réponse interrompue$/ : /Réponse non validée$/),
      ).toBeVisible();
      await expect(page.getByText(/journal.*avant de relancer/)).toBeVisible();
    }
    await expect(input).toBeEnabled();
    await page.locator('#chat').screenshot({ path: info.outputPath(`chat-${status}.png`) });
    if (status === 'cancelled') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#chat').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('chat-cancelled-mobile.png') });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
  });
}
