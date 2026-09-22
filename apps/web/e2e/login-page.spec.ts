import { test, expect } from './fixtures';

/**
 * Static smoke test: `/login` is a plain SPA route that renders without
 * calling the API (see src/routes/login/+page.svelte — the only fetch is on
 * form submit). This test must pass even with the API/DB down, so it's kept
 * separate from the authenticated tests in this suite.
 */
test.describe('login page (no backend required)', () => {
  test('renders the sign-in form', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
