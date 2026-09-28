import { test, expect } from './fixtures';
import { login } from './helpers';

const prefix = process.env.PULSAR_AUTONOMY_TENANT_PREFIX;
test.skip(!prefix, 'Prepare isolated HTTP autonomy fixtures first.');
test.use({ reducedMotion: 'reduce' });

test('Billing first-visit tutorial and documentation explain the document source', async ({
  page,
}) => {
  const tenant = `${prefix}-billing`;
  await login(page, { tenant, email: `reader@${tenant}.test`, password: 'Test1234!' });
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto('/invoices');
  const tour = page.getByTestId('module-tour');
  await expect(tour).toContainText('Des opérations aux preuves financières');
  for (let i = 0; i < 5; i++)
    await tour.getByRole('button', { name: 'Suivant', exact: true }).click();
  await expect(tour).toContainText('Reprendre la copie de la facture');
  await expect(tour).toContainText('une saisie différente demande un motif');
  await tour.getByRole('button', { name: 'Passer le tutoriel', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Factures et relevés', exact: true }),
  ).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.goto('/documentation?module=billing');
  await expect(page.getByText(/Source du client sur l’avoir :/)).toContainText(
    'Reprendre la copie de la facture',
  );
  await expect(page.getByText(/Après publication depuis la copie facture,/)).toContainText(
    'ni Clients, ni Transport, ni Services',
  );
});

test('Billing alone: publish frozen invoice coordinates and explicitly choose the recipient', async ({
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
  const draft = drafts.find((d: any) => d.invoiceNumber.startsWith('PDF-UI-'));
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
  const note = await request('post', `${invoicePath}/credits`, {
    operationKey: crypto.randomUUID(),
    expectedVersion: 0,
    reason: 'Correction commerciale de recette',
    lines: [{ invoiceLineId: invoice.lines[0].id, quantity: 1 }],
  });
  await request('post', `${invoicePath}/credits/${note.id}/issue`);
  const documentPath = `${invoicePath}/credits/${note.id}/document`;
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await login(page, credentials);
  await page.goto(`/invoices?statement=${invoice.id}`);
  const panel = page.getByRole('region', { name: 'Avoirs et solde client' });
  await panel.getByText('Document et envoi client', { exact: true }).click();
  await panel.getByLabel('Nom légal de l’émetteur').fill('Entreprise Démonstration');
  await panel
    .getByLabel('Adresse de l’émetteur')
    .fill('123 rue Exemple\nQuébec, QC, G1K 3X2\nCanada');
  await expect(panel.getByLabel('Nom légal du client')).toHaveValue('Client actuel modifié');
  await expect(panel.getByLabel('Motif de la saisie manuelle')).toBeVisible();
  await panel
    .getByRole('button', { name: 'Reprendre la copie de la facture', exact: true })
    .click();
  await expect(panel.getByLabel('Nom légal du client')).toHaveValue('Client historique PDF');
  await expect(panel.getByLabel('Adresse du client')).toHaveAttribute('readonly', '');
  const confirmation = panel.getByRole('checkbox', { name: /Je confirme les coordonnées/ });
  await confirmation.check();
  await panel.getByLabel('Adresse de l’émetteur').fill('123 rue Exemple\nQuébec, QC, G1K 3X2\nCA');
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  let lost = false;
  await page.route(`**${documentPath}`, async (route) => {
    if (route.request().method() !== 'POST' || lost) return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    lost = true;
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Réponse perdue après publication' }),
    });
  });
  await panel.getByRole('button', { name: 'Figer et générer le PDF', exact: true }).click();
  await expect(panel).toContainText('Réponse perdue après publication');
  await panel
    .getByRole('button', { name: 'Actualiser le document et l’envoi', exact: true })
    .click();
  await expect(panel).toContainText('PDF figé');
  await expect(panel.getByLabel('Provenance du destinataire')).toContainText('adresse v1');
  await expect(panel).toContainText('Mode simulation');
  const published = await request('get', documentPath);
  expect(published.deliveries).toEqual([]);
  expect(JSON.stringify(published.snapshot)).not.toContain('PRIVATE-');
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Télécharger le PDF d’avoir', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(testInfo.outputPath('credit-note.pdf'));
  const recipient = panel.getByLabel('Courriel du destinataire');
  await expect(recipient).toHaveValue('actuel@example.test');
  await panel
    .getByRole('button', { name: 'Reprendre le courriel du contact figé', exact: true })
    .click();
  await expect(recipient).toHaveValue('historique@example.test');
  const sendConfirmation = panel.getByRole('checkbox', {
    name: 'Je confirme la simulation, sans envoi externe.',
  });
  await sendConfirmation.check();
  await recipient.fill('choisi@example.test');
  await expect(sendConfirmation).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('credit-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await recipient.scrollIntoViewIfNeeded();
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: testInfo.outputPath('credit-mobile.png'), fullPage: true });
  await sendConfirmation.check();
  await panel.getByRole('button', { name: 'Simuler l’envoi de l’avoir', exact: true }).click();
  await expect(panel).toContainText('choisi@example.test');
  const sent = await request('get', documentPath);
  expect(sent.hash).toBe(published.hash);
  expect(sent.deliveries).toHaveLength(1);
  expect(sent.deliveries[0].toAddresses).toEqual(['choisi@example.test']);
  expect(sent.deliveries[0].deliveryChannel).toBe('log');
  expect(failures).toEqual([]);
});
