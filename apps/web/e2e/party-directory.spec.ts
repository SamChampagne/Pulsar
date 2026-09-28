import { test, expect } from './fixtures';
import { login } from './helpers';
const prefix = process.env.PULSAR_AUTONOMY_TENANT_PREFIX;
test.skip(!prefix, 'Run HTTP autonomy fixtures and provide their isolated prefix.');
for (const module of ['clients', 'services'])
  test(`${module} alone: versioned directory survives lost response and protects history`, async ({
    page,
  }, testInfo) => {
    const tenant = `${prefix}-${module}`,
      credentials = { tenant, email: `manager@${tenant}.test`, password: 'Test1234!' };
    const auth = await page.request.post('/api/v1/auth/login', { data: credentials });
    expect(auth.ok()).toBeTruthy();
    const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
    const endpoint = module === 'clients' ? 'clients/data/customers' : 'services/data/customers';
    const label = `Carnet UI ${Date.now()}`;
    const created = await page.request.post('/api/v1/' + endpoint, {
      headers,
      data: { code: `DIR-${Date.now()}`, name: label },
    });
    expect(created.ok()).toBeTruthy();
    const owner = await created.json(),
      path = `/api/v1/${endpoint}/${owner.id}/directory`;
    const failures: string[] = [];
    page.on('pageerror', (e) => failures.push(e.message));
    await login(page, credentials);
    await page.goto(module === 'clients' ? '/clients' : '/services/data');
    await page.getByRole('textbox', { name: 'Rechercher dans les données' }).fill(label);
    await page.getByRole('button', { name: `Carnet de ${label}`, exact: true }).click();
    let drawer = page.getByRole('dialog', { name: `Carnet · ${label}`, exact: true });
    await drawer.getByRole('button', { name: 'Ajouter une adresse', exact: true }).click();
    await drawer.getByLabel('Nom du site / adresse').fill('Dépôt Est');
    await drawer.getByLabel('Rue et numéro').fill('12 Rue du Port');
    await drawer.getByLabel('Ville', { exact: true }).fill('Montréal');
    await drawer.getByLabel('Code postal').fill('H2Y 1C6');
    await drawer.getByLabel('Motif de la modification').fill('Nouveau point de réception');
    await drawer.getByRole('button', { name: 'Enregistrer la version', exact: true }).click();
    await expect(drawer.getByRole('heading', { name: 'Dépôt Est', exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: 'Contacts', exact: true }).click();
    await drawer.getByRole('button', { name: 'Ajouter un contact', exact: true }).click();
    await drawer.getByLabel('Nom du contact').fill('Camille Service');
    await drawer.getByLabel('Courriel', { exact: true }).fill('camille@example.test');
    await drawer.getByLabel('Valide à partir du').fill('2026-09-01');
    await drawer.getByLabel('Fin de validité (exclue)').fill('2026-10-01');
    await drawer.getByLabel('Motif de la modification').fill('Interlocutrice temporaire');
    let lost = false;
    await page.route('**' + path, async (route) => {
      if (route.request().method() !== 'POST' || lost) return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      lost = true;
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Réponse perdue après validation' }),
      });
    });
    await drawer.getByRole('button', { name: 'Enregistrer la version', exact: true }).click();
    await expect(
      drawer.getByText('Réponse perdue après validation', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('textbox', { name: 'Rechercher dans les données' }).fill(label);
    await page.getByRole('button', { name: `Carnet de ${label}`, exact: true }).click();
    drawer = page.getByRole('dialog', { name: `Carnet · ${label}`, exact: true });
    await drawer
      .getByRole('button', { name: 'Vérifier / reprendre la même demande', exact: true })
      .click();
    await expect(
      drawer.getByRole('button', { name: 'Vérifier / reprendre la même demande', exact: true }),
    ).toHaveCount(0);
    await drawer.getByRole('button', { name: 'Contacts', exact: true }).click();
    await expect(
      drawer.getByRole('heading', { name: 'Camille Service', exact: true }),
    ).toBeVisible();
    await drawer.getByLabel('Validité au', { exact: true }).fill('2026-10-01');
    await expect(drawer.getByText('Expirée')).toBeVisible();
    const contacts = await page.request.get(path + '?kind=CONTACT', { headers });
    expect((await contacts.json()).total).toBe(1);
    await drawer.getByRole('button', { name: 'Modifier Camille Service', exact: true }).click();
    await drawer.getByLabel('Fiche active', { exact: true }).uncheck();
    await drawer.getByLabel('Motif de la modification').fill('Fin de collaboration');
    await drawer.getByRole('button', { name: 'Enregistrer la version', exact: true }).click();
    await expect(drawer.getByText('Désactivée')).toBeVisible();
    await drawer.getByRole('button', { name: 'Historique Camille Service', exact: true }).click();
    await expect(drawer.getByText(/2 versions/)).toBeVisible();
    await drawer.locator('summary').filter({ hasText: 'Version 1' }).click();
    await expect(drawer.getByText('Interlocutrice temporaire', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('directory-history.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('directory-mobile.png'), fullPage: true });
    expect(failures).toEqual([]);
  });
test('a reader can inspect the directory but cannot start an edit', async ({ page }) => {
  const tenant = `${prefix}-services`;
  await login(page, { tenant, email: `reader@${tenant}.test`, password: 'Test1234!' });
  await page.goto('/services/data');
  await page
    .getByRole('button', { name: /^Carnet de / })
    .first()
    .click();
  const drawer = page.getByRole('dialog');
  await expect(
    drawer.getByRole('button', { name: 'Ajouter une adresse', exact: true }),
  ).toHaveCount(0);
  await drawer.getByRole('button', { name: 'Contacts', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Ajouter un contact', exact: true })).toHaveCount(
    0,
  );
  await expect(drawer.getByRole('button', { name: /^Modifier / })).toHaveCount(0);
});
