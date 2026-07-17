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
// The web port is overridable (PW_WEB_PORT) so the CI preview path can be
// reproduced locally even when 5173 is taken (e.g. Docker Desktop reserves it on
// Windows). Defaults to 5173 — CI leaves it unset.
const WEB_PORT = process.env.PW_WEB_PORT || '5173';

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
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    // Desktop is the default surface for the authenticated app shell. It runs
    // every spec EXCEPT the *.mobile.spec.ts files (public/portal responsiveness).
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      testIgnore: /\.mobile\.spec\.ts$/,
    },
    // Tablet width — same authenticated specs, narrower shell (drawer sidebar).
    // Chromium engine (CI installs chromium only) at an iPad-portrait viewport,
    // rather than the webkit-based `iPad` device preset.
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 810, height: 1080 }, isMobile: false },
      testMatch: /responsive\.spec\.ts$/,
    },
    // Mobile — public/portal pages must be usable on a phone. Chromium engine at
    // a phone viewport (the Pixel 5 preset uses chromium, so it's safe).
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      testMatch: /\.mobile\.spec\.ts$/,
    },
  ],
  webServer: {
    // Invoke vite directly (pnpm exec) rather than `pnpm run preview -- …`:
    // pnpm forwards the `--` separator literally, so vite saw `-- --port` and
    // ignored the port, binding its default 4173 while Playwright waited on
    // WEB_PORT forever. This also fixes the real CI browser-e2e job.
    command: process.env.CI
      ? `pnpm run build && pnpm exec vite preview --port ${WEB_PORT} --strictPort`
      : 'pnpm run dev',
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: !process.env.CI,
    // CI builds the SPA then previews it — the full production build can take
    // ~1–2 min on a cold cache, so allow generous headroom before Playwright
    // gives up waiting for the server URL.
    timeout: 240_000,
  },
});
