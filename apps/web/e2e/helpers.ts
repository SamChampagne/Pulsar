import type { Page } from '@playwright/test';

/**
 * Seeded demo credentials (see packages/database/prisma/seed.ts and CLAUDE.md).
 * Authenticated e2e tests require the API + a seeded database reachable
 * through the web dev server's `/api` proxy.
 */
export const DEMO_USER = {
  email: 'admin@pulsar.dev',
  password: 'admin123',
  tenant: 'acme',
};

/** Logs in through the real UI form and waits for the authenticated landing route. */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(DEMO_USER.email);
  await page.getByLabel('Password').fill(DEMO_USER.password);
  await page.getByLabel('Tenant (optional)').fill(DEMO_USER.tenant);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}
