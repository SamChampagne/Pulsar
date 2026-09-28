import { test, expect } from './fixtures';
import { login } from './helpers';
const prefix = process.env.PULSAR_AUTONOMY_TENANT_PREFIX;
test.skip(!prefix, 'Prepare isolated HTTP autonomy fixtures first.');
test.use({ reducedMotion: 'reduce' });

test('Transport tutorial is specific and appears only on first user entry', async ({ page }) => {
  const tenant = `${prefix}-transportation`;
  await login(page, { tenant, email: `reader@${tenant}.test`, password: 'Test1234!' });
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto('/transport-orders');
  const tour = page.getByRole('dialog', {
    name: 'Du besoin commercial au mouvement réel',
    exact: true,
  });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Préparer les lieux et les interlocuteurs', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Revoir la commande avant de l’engager', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText(
    'Un avertissement impose de revoir la version du carnet',
  );
  await page.getByRole('button', { name: 'Passer le tutoriel', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Ordres de transport', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Passer le tutoriel', exact: true })).toHaveCount(
    0,
  );
});

for (const module of ['services', 'billing', 'transportation'])
  test(`${module}: select, recheck and freeze document coordinates`, async ({ page }, testInfo) => {
    const tenant = `${prefix}-${module}`;
    const credentials = { tenant, email: `manager@${tenant}.test`, password: 'Test1234!' };
    const session = await page.request.post('/api/v1/auth/login', { data: credentials });
    expect(session.ok()).toBeTruthy();
    const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
    const request = async (method: 'get' | 'post' | 'patch', path: string, data?: unknown) => {
      const r = await page.request[method]('/api/v1' + path, {
        headers,
        ...(data ? { data } : {}),
      });
      expect(r.ok(), await r.text()).toBeTruthy();
      return r.json();
    };
    const label = `Coordonnées ${Date.now()}`;
    let doc: any, owner: string, path: string;
    if (module === 'services') {
      const parent = await request('post', '/services/data/customers', {
        code: `DC-${Date.now()}`,
        name: label,
      });
      owner = parent.id;
      const item = await request('post', '/services/data/items', {
        code: `DC-${Date.now()}`,
        name: 'Inspection atelier',
        kind: 'SERVICE',
        unit: 'H',
      });
      doc = await request('post', '/services/quotes', {
        operationKey: crypto.randomUUID(),
        partnerId: owner,
        title: label,
        currency: 'CAD',
        lines: [{ catalogItemId: item.id, quantity: 2, unitPrice: 85 }],
      });
      path = `/services/quotes/${doc.id}`;
    } else if (module === 'transportation') {
      const parent = await request('post', '/transportation/customers', {
        code: `DC-${Date.now()}`,
        name: label,
      });
      owner = parent.id;
      const sites = await request('get', '/transportation/locations');
      const site = sites.items[0];
      expect(site).toBeTruthy();
      doc = await request('post', '/transportation/transport-orders', {
        customerId: owner,
        originLocationId: site.id,
        destinationLocationId: site.id,
        totalWeightKg: 250,
      });
      path = `/transportation/transport-orders/${doc.id}`;
    } else {
      const drafts = await request('get', '/billing/customer-invoices?status=DRAFT');
      doc = drafts.find((d: any) => d.invoiceNumber.startsWith('CO-UI-'));
      expect(doc, 'HTTP fixture leaves one DRAFT invoice for UI acceptance').toBeTruthy();
      owner = doc.customer.id;
      path = `/billing/customer-invoices/${doc.id}`;
    }
    const directoryPath = `${module === 'transportation' ? '/transportation/customers' : `/${module}/data/customers`}/${owner}/directory`;
    const data = {
      kind: 'ADDRESS',
      label,
      role: 'Facturation',
      active: true,
      email: '',
      phone: '',
      validFrom: null,
      validUntil: null,
      notes: '',
      address: {
        line1: '78 rue des Ateliers',
        line2: '',
        city: 'Québec',
        region: 'QC',
        countryCode: 'CA',
        postalCode: 'G1K 3X2',
      },
    };
    const entry = await request('post', directoryPath, {
      operationKey: crypto.randomUUID(),
      reason: 'Coordonnées de recette',
      entry: data,
    });
    const failures: string[] = [];
    page.on('pageerror', (e) => failures.push(e.message));
    await login(page, credentials);
    const open = async () => {
      if (module === 'services') {
        await page.goto('/services/quotes');
        await page.getByRole('textbox', { name: 'Rechercher un devis' }).fill(label);
        await page.getByRole('button', { name: 'Ouvrir le devis', exact: true }).click();
      } else if (module === 'transportation') await page.goto(`/transport-orders/${doc.id}`);
      else await page.goto(`/invoices?statement=${doc.id}`);
    };
    await open();
    let panel = page.getByRole('region', { name: 'Coordonnées du document' });
    await panel.getByRole('button', { name: 'Choisir / revoir les coordonnées' }).click();
    await panel.getByRole('textbox', { name: 'Rechercher dans le carnet' }).fill(label);
    await panel.getByRole('button', { name: `Choisir ${label}`, exact: true }).click();
    await panel.getByLabel('Motif du choix / changement').fill('Adresse confirmée avec le client');
    let lost = false;
    await page.route('**' + path + '/coordinates', async (route) => {
      if (route.request().method() !== 'PATCH' || lost) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      lost = true;
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Réponse perdue simulée après enregistrement' }),
      });
    });
    await panel.getByRole('button', { name: 'Enregistrer les coordonnées' }).click();
    await panel.getByRole('button', { name: 'Vérifier le document enregistré' }).click();
    await expect(panel).toContainText('78 rue des Ateliers');
    await page.unroute('**' + path + '/coordinates');
    await request('patch', `${directoryPath}/${entry.id}`, {
      operationKey: crypto.randomUUID(),
      expectedVersion: 1,
      reason: 'Correction de rue',
      entry: { ...data, address: { ...data.address, line1: '82 rue des Ateliers' } },
    });
    await open();
    panel = page.getByRole('region', { name: 'Coordonnées du document' });
    await expect(panel.getByRole('list', { name: 'Coordonnées à revoir' })).toContainText(
      'version 2',
    );
    await panel.getByRole('button', { name: 'Choisir / revoir les coordonnées' }).click();
    await panel.getByRole('textbox', { name: 'Rechercher dans le carnet' }).fill(label);
    await panel.getByRole('button', { name: `Choisir ${label}`, exact: true }).click();
    await panel.getByLabel('Motif du choix / changement').fill('Nouvelle adresse revue');
    await panel.getByRole('button', { name: 'Enregistrer les coordonnées' }).click();
    await expect(panel).toContainText('82 rue des Ateliers');
    if (module === 'services') {
      await page.getByRole('button', { name: 'Accepter le devis enregistré', exact: true }).click();
      await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
    } else if (module === 'transportation') {
      await page.getByRole('button', { name: 'Confirmer', exact: true }).click();
      await page.getByRole('button', { name: 'Confirmer la commande', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Approuver', exact: true }).click();
    }
    await expect(page.getByRole('region', { name: 'Coordonnées du document' })).toContainText(
      'Copie figée',
    );
    await request('patch', `${directoryPath}/${entry.id}`, {
      operationKey: crypto.randomUUID(),
      expectedVersion: 2,
      reason: 'Entrée retirée après accord',
      entry: { ...data, active: false },
    });
    await open();
    panel = page.getByRole('region', { name: 'Coordonnées du document' });
    await expect(panel).toContainText('82 rue des Ateliers');
    await expect(
      panel.getByRole('button', { name: 'Choisir / revoir les coordonnées' }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        panel.evaluate((el) => {
          for (let node: Element | null = el; node; node = node.parentElement) {
            if (Number(getComputedStyle(node).opacity) < 1) return false;
          }
          return true;
        }),
      )
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('coordinates-frozen.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => {
        const bounds = await panel.boundingBox();
        return !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391;
      })
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath('coordinates-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(failures).toEqual([]);
  });
