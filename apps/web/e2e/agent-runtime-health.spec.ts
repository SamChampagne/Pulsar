import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.AI_RUNTIME_TENANT;
test.skip(!tenant, 'Run the isolated AI runtime HTTP fixture first.');
test.use({ reducedMotion: 'reduce' });
test('local diagnostic, honest model check, responsive layout', async ({ page }, info) => {
  await login(page, { tenant: tenant!, email: `manager@${tenant}.test`, password: 'Test1234!' });
  await page.goto('/settings/agent-runtime');
  await expect(page.getByRole('heading', { name: 'Connexion IA', exact: true })).toBeVisible();
  const diagnostic = page.getByRole('region', { name: 'Diagnostic du moteur IA' });
  await expect(diagnostic.getByText('Version installée', { exact: true })).toBeVisible();
  await expect(diagnostic.getByText(/Version officielle repérée : 0.21.5/)).toBeVisible();
  await expect(diagnostic).toContainText('pas un contrôle en direct');
  // Explicit fake response. No real runtime session or provider call from this UI test.
  await page.route('**/api/v1/agent-runtime/test', (route) =>
    route.fulfill({
      json: {
        ok: true,
        scope: 'RUNTIME_ONLY',
        models: [{ value: 'test-model', label: 'Modèle de recette' }],
      },
    }),
  );
  await page.getByRole('button', { name: 'Vérifier le runtime', exact: true }).click();
  await expect(page.getByText('Session runtime ouverte — inférence non testée')).toBeVisible();
  await expect(page.getByText('Modèle de recette')).toBeVisible();
  await expect(page.getByText('[object Object]', { exact: true })).toHaveCount(0);
  await page.getByRole('heading', { name: 'Connexion IA', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('ai-runtime-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Connexion IA', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('ai-runtime-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test('provider changes require saving and do not carry a model or credential', async ({ page }) => {
  await login(page, { tenant: tenant!, email: `manager@${tenant}.test`, password: 'Test1234!' });
  await page.goto('/settings/agent-runtime');
  await page.getByLabel('Fournisseur du modèle').selectOption('openai');
  await expect(page.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1');
  await expect(page.getByLabel('Modèle (optionnel)')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Vérifier le runtime' })).toBeDisabled();
  await page.getByLabel('Fournisseur du modèle').selectOption('nous');
  await expect(page.getByRole('button', { name: 'Connecter Nous Portal (OAuth)' })).toBeDisabled();
  await expect(page.getByText('Des modifications ne sont pas enregistrées.')).toBeVisible();
});
