import { test, expect, type Page } from './fixtures';
import { login } from './helpers';
const tenant = process.env.DOSSIER_COMMUNICATIONS_TENANT;
test.skip(!tenant, 'Run isolated dossier communications HTTP fixtures first.');
test.use({ reducedMotion: 'reduce' });
async function open(page: Page, role = 'manager', authenticated = false) {
  if (!authenticated)
    await login(page, { tenant: tenant!, email: `${role}@${tenant}.test`, password: 'Test1234!' });
  await page.goto('/services/interventions');
  await page.getByRole('button').filter({ hasText: 'INT-COMM' }).click();
  await page.getByRole('button', { name: 'Communications', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Communications du dossier', exact: true });
  await expect(panel.getByRole('heading', { name: /INT-COMM/ })).toBeVisible();
  return panel;
}
test('service dossier: explicit recipient, model, preview and simulated SMS, desktop/mobile', async ({
  page,
}, info) => {
  const panel = await open(page);
  await panel.getByRole('button', { name: 'SMS', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Vérifier et simuler' })).toBeDisabled();
  await panel.getByLabel('Coordonnées du dossier').selectOption('+15145550222');
  await expect(panel.getByText('Messages opérationnels autorisés', { exact: true })).toBeVisible();
  const template = panel.getByLabel('Modèle (facultatif)');
  await template.selectOption({ label: 'Rappel personnalisé' });
  await expect(panel.getByLabel('Message', { exact: true })).toHaveValue(
    /Atelier des Rives.*INT-COMM/,
  );
  const message = `Recette dossier ${Date.now()}`;
  await panel.getByLabel('Message', { exact: true }).fill(message);
  await expect(panel.getByRole('region', { name: 'Aperçu du SMS' })).toContainText(message);
  await page.screenshot({ path: info.outputPath('dossier-sms-desktop.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Vérifier et simuler' }).click();
  await page.getByRole('button', { name: 'Simuler', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Simulation');
  await expect(panel.getByText(message, { exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('dossier-history-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test('lost response resumes the EXACT intent after reload, without duplicate', async ({ page }) => {
  let panel = await open(page);
  await panel.getByRole('button', { name: 'SMS', exact: true }).click();
  await panel.getByLabel('Numéro destinataire (E.164)').fill('+15145550222');
  await expect(panel.getByText('Messages opérationnels autorisés', { exact: true })).toBeVisible();
  const text = `Reprise dossier ${Date.now()}`;
  await panel.getByLabel('Message', { exact: true }).fill(text);
  const bodies: object[] = [];
  await page.route('**/api/v1/communications/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (bodies.length === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await panel.getByRole('button', { name: 'Vérifier et simuler' }).click();
  await page.getByRole('button', { name: 'Simuler', exact: true }).click();
  await expect(panel.getByText('Demande conservée', { exact: true })).toBeVisible();
  await page.reload();
  panel = await open(page, 'manager', true);
  await panel.getByRole('button', { name: 'Vérifier l’envoi', exact: true }).click();
  await expect(panel.getByText('Demande conservée', { exact: true })).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  await expect(panel.getByText(text, { exact: true })).toHaveCount(1);
});
test('records contact evidence, blocks STOP and creates an editable email template', async ({
  page,
}, info) => {
  const panel = await open(page);
  const recipient = `contact-${Date.now()}@example.test`;
  await panel.getByLabel('Adresse destinataire').fill(recipient);
  await expect(
    panel.getByRole('button', { name: 'Enregistrer la décision', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Enregistrer la décision', exact: true }).click();
  await panel
    .getByLabel('Preuve ou référence de la décision')
    .fill('Demande du contact, recette locale');
  await panel.getByLabel('Date de la décision').fill('2026-09-01');
  await panel.getByRole('button', { name: 'Autoriser', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Enregistrer la décision du contact' })
    .getByRole('button', { name: 'Enregistrer', exact: true })
    .click();
  await expect(panel.getByText('Messages opérationnels autorisés', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Modèles', exact: true }).click();
  await panel.getByRole('button', { name: 'Nouveau modèle' }).click();
  const name = `Suivi ${Date.now()}`;
  await panel.getByLabel('Nom du modèle').fill(name);
  await panel.getByLabel('Objet du modèle').fill('Suivi de {{dossier}}');
  await panel
    .getByLabel('Texte du modèle')
    .fill('Bonjour {{client}}, votre dossier est en préparation.');
  await panel.getByRole('button', { name: 'Enregistrer le modèle' }).click();
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Composer', exact: true }).click();
  await panel.getByLabel('Modèle (facultatif)').selectOption({ label: name });
  await expect(panel.getByLabel('Objet', { exact: true })).toHaveValue(/INT-COMM/);
  await expect(
    panel
      .frameLocator('iframe')
      .getByText('Bonjour Atelier des Rives, votre dossier est en préparation.'),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('dossier-email-desktop.png'), fullPage: true });
  await panel.getByRole('button', { name: 'SMS', exact: true }).click();
  await panel.getByLabel('Numéro destinataire (E.164)').fill('+15145550223');
  await expect(panel.getByText('STOP reçu — envoi bloqué', { exact: true })).toBeVisible();
  await panel.getByLabel('Message', { exact: true }).fill('Ne doit pas partir');
  await expect(panel.getByRole('button', { name: 'Vérifier et simuler' })).toBeDisabled();
});
test('read-only source role can inspect history but not authorize, configure templates or send', async ({
  page,
}) => {
  const panel = await open(page, 'reader');
  await expect(panel.getByRole('button', { name: 'Courriel', exact: true })).toHaveCount(0);
  await panel.getByLabel('Numéro destinataire (E.164)').fill('+15145550222');
  await expect(panel.getByText('Messages opérationnels autorisés', { exact: true })).toBeVisible();
  await expect(
    panel.getByRole('button', { name: 'Enregistrer la décision', exact: true }),
  ).toHaveCount(0);
  await panel.getByLabel('Message', { exact: true }).fill('Lecture seule');
  await expect(panel.getByRole('button', { name: 'Vérifier et simuler' })).toBeDisabled();
  await panel.getByRole('button', { name: 'Modèles', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Nouveau modèle' })).toHaveCount(0);
});

test('client, CRM and shipment expose the same panel with their own contacts', async ({ page }) => {
  await login(page, { tenant: tenant!, email: `manager@${tenant}.test`, password: 'Test1234!' });
  const session = await page.request.post('/api/v1/auth/login', {
    data: { tenant, email: `manager@${tenant}.test`, password: 'Test1234!' },
  });
  const headers = { Authorization: `Bearer ${(await session.json()).accessToken}` };
  const response = await page.request.get('/api/v1/crm/deals', { headers });
  expect(response.ok()).toBe(true);
  const deals = await response.json();
  const deal = (deals.items ?? deals).find((d: { title: string }) => d.title === 'Mandat atelier');
  expect(deal).toBeTruthy();
  await page.goto(`/crm/deals/${deal.id}`);
  await page.getByRole('button', { name: 'Communications', exact: true }).click();
  let panel = page.getByRole('dialog', { name: 'Communications du dossier', exact: true });
  await expect(panel.getByRole('heading', { name: 'Mandat atelier', exact: true })).toBeVisible();
  await panel.getByLabel('Coordonnées du dossier').selectOption('alice@example.test');
  await expect(panel.getByLabel('Adresse destinataire')).toHaveValue('alice@example.test');
  await page.goto('/shipments');
  await page.getByRole('cell', { name: 'SH-COMM', exact: true }).click();
  await page.getByRole('button', { name: 'Communications', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Communications du dossier', exact: true });
  await panel.getByRole('button', { name: 'SMS', exact: true }).click();
  await panel.getByLabel('Coordonnées du dossier').selectOption('+15145550666');
  await expect(panel.getByLabel('Numéro destinataire (E.164)')).toHaveValue('+15145550666');
  await page.goto('/clients');
  await page
    .getByRole('row')
    .filter({ hasText: 'Transport client' })
    .getByRole('button', { name: 'Communications', exact: true })
    .click();
  panel = page.getByRole('dialog', { name: 'Communications du dossier', exact: true });
  await expect(panel.getByRole('heading', { name: 'Transport client', exact: true })).toBeVisible();
});
