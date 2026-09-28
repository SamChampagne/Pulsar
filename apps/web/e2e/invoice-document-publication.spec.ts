import { test, expect } from './fixtures';
import { login } from './helpers';
const prefix = process.env.PULSAR_AUTONOMY_TENANT_PREFIX;
test.skip(!prefix, 'Prepare isolated HTTP autonomy fixtures first.');
test.use({ reducedMotion: 'reduce' });

test('Invoice publication: frozen source, uncertain replies and explicit simulation', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const tenant = `${prefix}-billing`;
  const credentials = { tenant, email: `manager@${tenant}.test`, password: 'Test1234!' };
  const session = await page.request.post('/api/v1/auth/login', { data: credentials });
  expect(session.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const request = async (method: 'get' | 'post' | 'patch', path: string, data?: unknown) => {
    const response = await page.request[method](`/api/v1${path}`, {
      headers,
      ...(data ? { data } : {}),
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const drafts = await request('get', '/billing/customer-invoices?status=DRAFT');
  const draft = drafts.find((d: any) => d.invoiceNumber.startsWith('INV-UI-'));
  expect(draft, 'Dedicated HTTP fixture remains a draft with billable lines').toBeTruthy();
  const invoicePath = `/billing/customer-invoices/${draft.id}`;
  const invoice = await request('get', invoicePath);
  const customerPath = `/billing/data/customers/${invoice.customer.id}`;
  await request('patch', customerPath, {
    name: 'Client historique PDF',
    email: 'ancien@example.test',
  });
  const entryData = {
    kind: 'ADDRESS',
    label: 'Bureau de facturation',
    role: 'Facturation',
    active: true,
    validFrom: null,
    validUntil: null,
    email: '',
    phone: '',
    notes: 'PRIVATE-ADDRESS',
    address: {
      line1: '42 rue du Parc',
      line2: 'Bureau 205',
      city: 'Québec',
      region: 'QC',
      postalCode: 'G1K 3X2',
      countryCode: 'CA',
    },
  };
  const entry = await request('post', `${customerPath}/directory`, {
    operationKey: crypto.randomUUID(),
    reason: 'Adresse de recette',
    entry: entryData,
  });
  const contact = await request('post', `${customerPath}/directory`, {
    operationKey: crypto.randomUUID(),
    reason: 'Contact de recette',
    entry: {
      ...entryData,
      kind: 'CONTACT',
      address: null,
      label: 'Comptabilité historique',
      email: 'historique@example.test',
      notes: 'PRIVATE-CONTACT',
    },
  });
  const selected = await request('patch', `${invoicePath}/coordinates`, {
    expectedUpdatedAt: invoice.updatedAt,
    reason: 'Accord de facturation vérifié',
    selections: {
      billingAddress: { id: entry.id, version: 1 },
      deliveryAddress: null,
      contact: { id: contact.id, version: 1 },
    },
  });
  await request('post', `${invoicePath}/approve`, { expectedUpdatedAt: selected.updatedAt });
  await request('patch', customerPath, {
    name: 'Client actuel modifié',
    email: 'actuel@example.test',
  });
  await request('patch', `${customerPath}/directory/${entry.id}`, {
    operationKey: crypto.randomUUID(),
    expectedVersion: 1,
    reason: 'Fermeture du bureau',
    entry: { ...entryData, active: false },
  });

  const documentPath = `${invoicePath}/document`;
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await login(page, credentials);
  await page.goto(`/invoices?statement=${invoice.id}`);
  const panel = page
    .locator('details')
    .filter({ has: page.getByText('Document et envoi de la facture', { exact: true }) });
  await panel.getByText('Document et envoi de la facture', { exact: true }).click();
  await panel.getByLabel('Nom légal de l’émetteur').fill('Atelier Démonstration');
  await panel.getByLabel('Adresse de l’émetteur').fill('123 rue Exemple\nQuébec, QC, G1K 3X2');
  await panel
    .getByRole('button', { name: 'Reprendre la copie de la facture', exact: true })
    .click();
  await expect(panel.getByLabel('Nom légal du client')).toHaveValue('Client historique PDF');
  await panel.getByRole('checkbox', { name: /Je confirme les coordonnées/ }).check();
  let lost = false;
  await page.route(`**${documentPath}`, async (route) => {
    if (route.request().method() !== 'POST' || lost) return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    lost = true;
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Réponse perdue après publication de facture' }),
    });
  });
  await panel.getByRole('button', { name: 'Figer et générer le PDF', exact: true }).click();
  await expect(panel).toContainText('Réponse perdue après publication de facture');
  await panel
    .getByRole('button', { name: 'Actualiser le document et l’envoi', exact: true })
    .click();
  await expect(panel).toContainText('PDF figé');
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Télécharger le PDF de facture', exact: true }).click();
  await (await downloadPromise).saveAs(testInfo.outputPath('invoice.pdf'));
  const published = await request('get', documentPath);
  expect(published.deliveries).toEqual([]);
  await panel
    .getByRole('button', { name: 'Reprendre le courriel du contact figé', exact: true })
    .click();
  const recipient = panel.getByLabel('Courriel du destinataire');
  await expect(recipient).toHaveValue('historique@example.test');
  const confirmation = panel.getByRole('checkbox', {
    name: 'Je confirme la simulation, sans envoi externe.',
  });
  await confirmation.check();
  await recipient.fill('destinataire-revu@example.test');
  await expect(confirmation).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('invoice-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await recipient.scrollIntoViewIfNeeded();
  const box = await panel.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: testInfo.outputPath('invoice-mobile.png'), fullPage: true });
  await confirmation.check();
  let sendLost = false;
  await page.route(`**${documentPath}/send`, async (route) => {
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    sendLost = true;
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Réponse perdue après mise en file' }),
    });
  });
  await panel.getByRole('button', { name: 'Simuler l’envoi de la facture', exact: true }).click();
  await expect(panel).toContainText('Réponse perdue après mise en file');
  await panel
    .getByRole('button', { name: 'Actualiser le document et l’envoi', exact: true })
    .click();
  await expect(
    panel.getByRole('button', { name: 'Simuler l’envoi de la facture', exact: true }),
  ).toHaveCount(0);
  expect(sendLost).toBe(true);
  const sent = await request('get', documentPath);
  expect(sent.hash).toBe(published.hash);
  expect(sent.deliveries).toHaveLength(1);
  expect(sent.deliveries[0].toAddresses).toEqual(['destinataire-revu@example.test']);
  expect(sent.deliveries[0].deliveryChannel).toBe('log');
  expect((await request('get', invoicePath)).status).toBe('APPROVED');
  expect(failures).toEqual([]);
});
