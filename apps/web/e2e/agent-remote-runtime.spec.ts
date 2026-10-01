import { test, expect } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';

for (const status of ['unassigned', 'unreachable', 'ready'] as const) {
  test(`remote IA diagnostic: ${status}, no API installation command`, async ({ page }, info) => {
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
            permissions: ['core.agents.manage', 'core.agents.read'],
          },
          tenant: { id: 'fixture', slug: 'fixture', name: 'Test IA', enabledModules: [] },
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
    await page.route('**/api/v1/agent-runtime**', (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({
        json: path.endsWith('/providers')
          ? [{ id: 'openrouter', label: 'OpenRouter', authMode: 'apiKey' }]
          : path.endsWith('/health')
            ? {
                checkedAt: '2026-09-30T12:00:00Z',
                installed: status === 'ready',
                runtimeMode: 'remote',
                runnerStatus: status,
                installedVersion: status === 'ready' ? '0.16.0' : null,
                assessment: status === 'ready' ? 'reference-match' : 'not-installed',
                reference: {
                  version: '0.16.0',
                  upstreamVersion: '0.21.5',
                  upstreamCheckedAt: '2026-09-27',
                  upstreamUrl:
                    'https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.24',
                },
              }
            : {
                installed: status === 'ready',
                runtimeMode: 'remote',
                configured: true,
                provider: 'openrouter',
                authMode: 'apiKey',
                defaultModel: 'fixture-model',
              },
      });
    });
    await page.goto('/settings/agent-runtime');
    await expect(page.getByRole('heading', { name: 'Connexion IA', exact: true })).toBeVisible();
    await expect(page.getByText('pnpm agents:setup', { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(
        status === 'ready'
          ? /Service IA joignable/
          : status === 'unassigned'
            ? /Aucun runner valide rattaché/
            : /Le runner rattaché ne répond pas/,
      ),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath(`runner-${status}.png`), fullPage: true });
    if (status === 'unassigned') {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath('runner-mobile.png'), fullPage: true });
    }
  });
}
