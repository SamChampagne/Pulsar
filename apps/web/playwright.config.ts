import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E foundation (Wave 6, operational-convergence).
 *
 * Two tiers of tests live under ./e2e:
 *  - Static/no-backend: e2e/login-page.spec.ts. Only needs the web dev/preview
 *    server (`/login` is a plain SPA route — it doesn't call the API until the
 *    form is submitted), so it passes even with the API down.
 *  - Authenticated: everything else. Needs the NestJS API (`pnpm dev:api` or a
 *    built server) AND a seeded database (`pnpm db:up && pnpm db:migrate &&
 *    pnpm db:seed`) reachable through the web dev server's `/api` proxy (see
 *    vite.config.ts). Log in as admin@pulsar.dev / admin123, tenant "acme".
 *
 * `webServer` below only starts the WEB server — it does not start the API or
 * touch the database. Run the API + seeded DB yourself before the authenticated
 * tests will pass; the login-page test alone works without them.
 *
 * Locally it runs the plain vite dev server (fast reuse across runs). In CI
 * (`process.env.CI`, set automatically by GitHub Actions) it builds and serves
 * the static preview bundle instead — the `browser-e2e` job in
 * .github/workflows/ci.yml starts the API separately against a migrated +
 * seeded Postgres service container before invoking Playwright.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.CI
      ? 'pnpm run build && pnpm run preview -- --port 5173 --strictPort'
      : 'pnpm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
