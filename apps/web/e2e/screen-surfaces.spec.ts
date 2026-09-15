import { test, expect } from '@playwright/test';
import { login } from './helpers';

// Read-only surface checks. These do not claim to exercise each business workflow.
const routes = [
  '/agent-actions',
  '/agents',
  '/analytics',
  '/analytics/scorecards',
  '/assets',
  '/automation',
  '/billing/banking',
  '/billing/budgets',
  '/billing/config',
  '/billing/fixed-assets',
  '/billing/subscriptions',
  '/connect/config',
  '/connect/inbox',
  '/control-tower',
  '/crm',
  '/crm/companies',
  '/crm/contacts',
  '/documents',
  '/fleet',
  '/fleet/register',
  '/fleet/config',
  '/fleet/maintenance',
  '/integrations',
  '/invoices',
  '/loads',
  '/personalize',
  '/planning',
  '/procurement/config',
  '/rate-studio',
  '/settings/agents',
  '/shipments',
  '/sites',
  '/transport-orders',
  '/transportation/config',
  '/wms',
  '/wms/config',
  '/wms/cycle-counts',
  '/yard/config',
  '/yard/gate',
  '/yard/spots',
];

for (const route of routes) {
  test(`screen mounts after redesign: ${route}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await login(page);
    await page.goto(route);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(new URL(page.url()).pathname).toBe(route);
  });
}
