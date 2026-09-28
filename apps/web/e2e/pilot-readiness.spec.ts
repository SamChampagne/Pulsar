import { test, expect } from './fixtures';
const email = process.env.PILOT_PLATFORM_EMAIL;
test.describe('Pilot preparation in platform operations', () => {
  test.skip(!email, 'Isolated platform fixture required');
  test.beforeEach(async ({ page }) => {
    await page.goto('/platform/login');
    await page.getByLabel('Email').fill(email!);
    await page.getByLabel('Password').fill('Test1234!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/platform/tenants');
    await page.getByRole('link', { name: 'Exploitation', exact: true }).click();
  });
  test('profile-specific checks, read-only report and mobile layout', async ({ page }, info) => {
    const region = page.getByRole('region', { name: 'Préparer le pilote' });
    await expect(region).toBeVisible();
    await expect(region.getByLabel('Profil du pilote')).toHaveValue('SERVICES');
    await expect(region.locator('[data-pilot-check=aps]')).toHaveCount(0);
    await region.locator('[data-pilot-check=migrations] summary').click();
    await expect(region.locator('[data-pilot-check=migrations]')).toContainText(
      'scripts correspondent',
    );
    await region.getByLabel('Profil du pilote').selectOption('MANUFACTURING');
    await expect(region.locator('[data-pilot-check=aps]')).toBeVisible();
    await expect(region.locator('[data-pilot-check=scanners]')).toBeVisible();
    await region.getByLabel('Inclure les agents IA').check();
    await expect(region.locator('[data-pilot-check=agent-mission]')).toContainText(
      'Mission IA gouvernée',
    );
    await region.locator('[data-pilot-check=agent-mission] summary').click();
    await expect(region).toContainText('fournisseur et budget autorisés');
    await region
      .getByRole('heading', { name: 'Préparer le pilote', exact: true })
      .evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: info.outputPath('pilot-desktop.png'), fullPage: true });
    const downloaded = page.waitForEvent('download');
    await region.getByRole('button', { name: 'Exporter le précontrôle' }).click();
    const file = await downloaded;
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(report.profile).toBe('MANUFACTURING');
    expect(report.agents).toBe(true);
    expect(report).not.toHaveProperty('tenants');
    expect(report).not.toHaveProperty('queues');
    expect(report.checks.find((c: any) => c.key === 'restore').state).toBe('TO_VERIFY');
    expect(report.status).not.toBe('READY');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('pilot-mobile.png'), fullPage: true });
  });
  test('failed refresh retains observations but prevents exporting them as current', async ({
    page,
  }) => {
    const region = page.getByRole('region', { name: 'Préparer le pilote' });
    await expect(region).toBeVisible();
    await page.route('**/api/v1/platform/operations', (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
    );
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
    await expect(region).toContainText('Observation précédente');
    await expect(region.getByRole('button', { name: 'Exporter le précontrôle' })).toBeDisabled();
    await page.unroute('**/api/v1/platform/operations');
    await page.getByRole('button', { name: 'Actualiser', exact: true }).click();
    await expect(region.getByRole('button', { name: 'Exporter le précontrôle' })).toBeEnabled();
  });
});
