import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.LEDGER_CURRENCY_TENANT;
const creds = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});
test.describe('I2m.2a currency-safe Finance', () => {
  test.skip(!tenant, 'Isolated ledger-currency HTTP fixture required');
  test('requires currency, discloses exclusions and ignores late results', async ({
    page,
  }, info) => {
    await login(page, creds('reader'));
    await page.goto('/billing/reports');
    await expect(
      page.getByText('Choisissez une devise avant de calculer.', { exact: false }),
    ).toBeVisible();
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => (release = r));
    let started: () => void = () => {};
    const waiting = new Promise<void>((r) => (started = r));
    await page.route('**/api/v1/billing/reports/profit-and-loss?**', async (route) => {
      const currency = new URL(route.request().url()).searchParams.get('currency');
      const r = await route.fetch();
      if (currency === 'USD') {
        started();
        await hold;
      }
      await route.fulfill({ response: r });
    });
    await page.getByLabel('Devise du rapport').selectOption('USD');
    await waiting;
    await page.getByLabel('Devise du rapport').selectOption('CAD');
    const coverage = page.getByRole('region', { name: 'Portée du rapport' });
    await expect(coverage).toContainText('Devise de transaction : CAD');
    release();
    await expect(coverage).toContainText('sans devise exclue');
    await expect(coverage).toContainText('Autres devises exclues');
    await page.screenshot({ path: info.outputPath('reports-desktop.png'), fullPage: true });
    await page.getByRole('link', { name: 'Consulter les écritures à qualifier' }).click();
    await expect(page.getByLabel('Devise du journal')).toHaveValue('UNQUALIFIED');
    await expect(page.getByRole('button', { name: 'Nouvelle écriture manuelle' })).toHaveCount(0);
    await page.goto('/billing/reports');
    await page.getByLabel('Devise du rapport').selectOption('EUR');
    await expect(
      page.getByText('90\u202f071\u202f992\u202f547\u202f409\u202f930,01', { exact: true }).first(),
    ).toBeVisible();
    await page.route('**/api/v1/billing/reports/profit-and-loss?**', (r) =>
      r.fulfill({ status: 503, json: { message: 'Rapport indisponible' } }),
    );
    await page.getByLabel('Devise du rapport').selectOption('MXN');
    await expect(page.getByRole('alert')).toContainText('Rapport indisponible');
    await expect(coverage).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('reports-mobile.png'), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
  test('manual posting confirms currency and resumes exact request after commit, failure and reload', async ({
    page,
  }, info) => {
    test.setTimeout(90000);
    await login(page, creds());
    await page.goto('/billing/ledger?sourceType=manual');
    await page.getByRole('button', { name: 'Nouvelle écriture manuelle', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Nouvelle écriture manuelle', exact: true });
    await panel.getByLabel('Devise de l’écriture').selectOption('CAD');
    await panel.getByLabel('Date', { exact: true }).fill('2026-09-27');
    for (const [i, code] of [
      [1, '1000'],
      [2, '4000'],
    ] as const) {
      await panel.getByRole('button', { name: new RegExp('^Compte · ligne ' + i + ' :') }).click();
      await page
        .getByRole('dialog', { name: 'Compte · ligne ' + i, exact: true })
        .getByRole('option', { name: new RegExp('^' + code) })
        .click();
    }
    await panel.getByLabel('Débit · ligne 1').fill('0.30');
    await panel.getByLabel('Crédit · ligne 2').fill('0.30');
    let attempts = 0,
      original = '';
    await page.route('**/api/v1/billing/ledger/entries', async (route) => {
      attempts++;
      if (attempts === 1) {
        original = route.request().postData()!;
        const r = await route.fetch();
        expect(r.ok()).toBeTruthy();
        return route.fulfill({
          status: 503,
          json: { message: 'Écriture conservée, réponse perdue' },
        });
      }
      expect(route.request().postData()).toBe(original);
      if (attempts === 2)
        return route.fulfill({ status: 403, json: { message: 'Refus intermédiaire' } });
      const r = await route.fetch();
      expect((await r.json()).posted).toBe(false);
      return route.fulfill({ response: r });
    });
    await panel.getByRole('button', { name: 'Comptabiliser l’écriture', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Comptabiliser l’écriture ?', exact: true })
      .getByRole('button', { name: 'Comptabiliser', exact: true })
      .click();
    await expect(panel.getByRole('alert')).toContainText('réponse perdue');
    await panel.getByRole('button', { name: 'Reprendre la même écriture', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Refus intermédiaire');
    await page.reload();
    await expect(panel.getByText('Écriture à vérifier', { exact: true })).toBeVisible();
    await expect(panel.getByLabel('Devise de l’écriture')).toHaveValue('CAD');
    await expect(panel.getByLabel('Débit · ligne 1')).toHaveValue('0.30');
    await expect(panel.getByLabel('Devise de l’écriture')).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('manual-recovery-mobile.png'), fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await panel.getByRole('button', { name: 'Reprendre la même écriture', exact: true }).click();
    await expect(panel).toHaveCount(0);
    expect(attempts).toBe(3);
    const a = await page.request.post('/api/v1/auth/login', { data: creds() }),
      headers = { Authorization: `Bearer ${(await a.json()).accessToken}` };
    const key = JSON.parse(original).operationKey;
    const journal = await page.request.get(
      '/api/v1/billing/ledger/journal?sourceType=manual&sourceId=' + key,
      { headers },
    );
    expect((await journal.json()).total).toBe(1);
  });
  test('trial balance stays explicitly scoped and mobile-safe', async ({ page }, info) => {
    await login(page, creds('reader'));
    await page.goto('/billing/ledger');
    await page.getByRole('tab', { name: 'Balance', exact: true }).click();
    await page.getByLabel('Devise de la balance').selectOption('CAD');
    await expect(
      page.getByRole('cell', { name: 'Équilibre arithmétique', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Portée du rapport' })).toContainText(
      'rapport est partiel',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('trial-balance-mobile.png'), fullPage: true });
  });
});
