import { test, expect } from './fixtures';
import { login } from './helpers';
const tenant = process.env.COMMUNICATIONS_TENANT;
test.skip(!tenant, 'Run the isolated communications HTTP fixtures first.');
test.use({ reducedMotion: 'reduce' });
const credentials = (role = 'manager') => ({
  tenant: tenant!,
  email: `${role}@${tenant}.test`,
  password: 'Test1234!',
});

test('SMS preview, confirmation, simulation and responsive journal', async ({ page }, info) => {
  await login(page, credentials());
  await page.goto('/connect/sms');
  await expect(page.getByRole('heading', { name: 'Préparer un SMS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simuler le SMS' })).toBeDisabled();
  const message = `Rendez-vous confirmé — recette ${Date.now()}`;
  await page.getByLabel('Destinataire (E.164)', { exact: true }).fill('+15145550456');
  await page.getByLabel('Message', { exact: true }).fill(message);
  await expect(page.locator('aside').filter({ hasText: 'Aperçu uniquement' })).toContainText(
    message,
  );
  await page.getByLabel('Je confirme le numéro').check();
  await page.screenshot({ path: info.outputPath('sms-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Simuler le SMS' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Simulation' })).toBeVisible();
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('sms-mobile.png'), fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test('SMS lost response is resumed with the exact operation key after reload', async ({ page }) => {
  await login(page, credentials());
  await page.goto('/connect/sms');
  const message = `Reprise exacte ${Date.now()}`;
  await page.getByLabel('Destinataire (E.164)', { exact: true }).fill('+15145550456');
  await page.getByLabel('Message', { exact: true }).fill(message);
  await page.getByLabel('Je confirme le numéro').check();
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/sms/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (bodies.length === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Simuler le SMS' }).click();
  await expect(page.getByRole('heading', { name: 'Envoi à vérifier' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre la même demande' }).click();
  await expect(page.getByRole('heading', { name: 'Envoi à vérifier' })).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
});

test('read-only SMS role sees journal without sending or configuration', async ({ page }) => {
  await login(page, credentials('reader'));
  await page.goto('/connect/sms');
  await expect(page.getByRole('heading', { name: 'Journal des SMS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Configurer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Préparer un SMS' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'SMS · Telnyx', exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Toutes les connexions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Telnyx — SMS', exact: true })).toBeVisible();
  await expect(page.getByText('Simulation — aucun envoi', { exact: false })).toBeVisible();
});

test('SMS configuration is in-app and real activation requires confirmation; STOP is visible', async ({
  page,
}, info) => {
  await login(page, credentials());
  await page.goto('/connect/sms');
  await page.getByRole('button', { name: 'Configurer', exact: true }).click();
  await expect(page.getByLabel('Clé publique Telnyx (Ed25519)')).not.toHaveValue('');
  await expect(page.getByLabel('Adresse HTTPS publique de Pulsar')).toHaveValue(
    'https://pulsar.example.test',
  );
  await expect(page.getByText('SMS_DRIVER=telnyx', { exact: false })).toHaveCount(0);
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/v1/sms/config', async (route) => {
    writes.push(route.request().postDataJSON());
    // UI confirmation only: never authorize this fixture for real networking.
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.getByLabel('Mode réel — peut engendrer des frais').check();
  await page.getByRole('button', { name: 'Enregistrer la connexion' }).click();
  await expect(page.getByRole('dialog')).toContainText('Activer Telnyx dans Pulsar');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Enregistrer la connexion' }).click();
  await page.getByRole('button', { name: 'Autoriser le mode réel', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ live: true, confirmLive: true });
  await expect(page.getByRole('button', { name: 'Simuler le SMS' })).toBeVisible();
  await page.getByRole('button', { name: 'Désabonnements STOP', exact: true }).click();
  const inbox = page.getByRole('region', { name: 'Réponses SMS et désabonnements' });
  await expect(inbox.getByText('+15145550999', { exact: true })).toBeVisible();
  await expect(inbox.getByText('STOP · envois bloqués', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('sms-stop-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Configurer', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('sms-config-mobile.png'), fullPage: true });
  await page.getByLabel('Adresse HTTPS publique de Pulsar').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('sms-webhooks-mobile.png'), fullPage: true });
  await inbox.screenshot({ path: info.outputPath('sms-stop-mobile.png') });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test('IMAP real mode is explained and confirmed in the app without a server variable', async ({
  page,
}) => {
  await login(page, credentials());
  await page.goto('/emails/config');
  await page.getByRole('button', { name: '2 · Réception', exact: true }).click();
  await expect(page.getByText('requiert EMAIL_DRIVER', { exact: false })).toHaveCount(0);
  await page.getByLabel('Mode IMAP réel — lire la boîte distante').check();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Autoriser la réception réelle');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '2 · Réception', exact: true }).click();
  await expect(page.getByLabel('Mode IMAP réel — lire la boîte distante')).not.toBeChecked();
});

test('email presets, identity preview, saved state and explicit test confirmation', async ({
  page,
}, info) => {
  await login(page, credentials());
  await page.goto('/emails/config');
  await page.getByRole('button', { name: 'Brevo', exact: true }).click();
  await expect(page.getByLabel('Hôte SMTP', { exact: true })).toHaveValue('smtp-relay.brevo.com');
  await page
    .getByLabel('Nom de l’expéditeur', { exact: true })
    .fill(`Atelier des Rives ${Date.now()}`);
  await page.getByLabel('Adresse de l’expéditeur', { exact: true }).fill('atelier@example.test');
  await page.getByLabel('Répondre à', { exact: true }).fill('suivi@example.test');
  await expect(page.getByRole('region', { name: 'Aperçu du courriel' })).toContainText(
    'suivi@example.test',
  );
  await page.locator('#workspace-content').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: info.outputPath('email-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '3 · Vérification', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Envoyer un test' })).toBeDisabled();
  // Config stays inactive: never use these fake credentials for a real send.
  await page.getByRole('button', { name: '1 · Envoi et identité', exact: true }).click();
  await page.getByLabel('Utiliser le SMTP de cette entreprise').uncheck();
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText('Configuration enregistrée')).toBeVisible();
  await page.getByRole('button', { name: '3 · Vérification', exact: true }).click();
  await page.getByLabel('Adresse de test').fill('recipient@example.test');
  await expect(page.getByRole('button', { name: 'Envoyer un test' })).toBeDisabled();
  await page.getByLabel('Je confirme l’envoi vers cette adresse').check();
  await page.route('**/api/v1/email-config/test', (route) =>
    route.fulfill({ json: { ok: true, simulated: true } }),
  );
  await page.getByRole('button', { name: 'Envoyer un test' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Simulation réussie' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Aperçu mobile' }).click();
  await expect(
    page
      .frameLocator('iframe[title="Aperçu sécurisé du courriel"]')
      .getByText('Bonjour,', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('region', { name: 'Aperçu du courriel' })
    .screenshot({ path: info.outputPath('email-mobile-preview.png') });
  await page.screenshot({ path: info.outputPath('email-mobile.png'), fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test('template preview is isolated and blocks scripts, navigation and remote tracking', async ({
  page,
}, info) => {
  let remoteRequests = 0;
  await page.route('https://tracking.example.test/**', (route) => {
    remoteRequests++;
    return route.abort();
  });
  await login(page, credentials());
  await page.goto('/emails/templates');
  await page.getByRole('button', { name: 'Nouveau gabarit', exact: true }).click();
  await page.getByLabel('Sujet', { exact: true }).fill('Votre intervention');
  await page.getByRole('button', { name: 'HTML avancé' }).click();
  await page
    .getByLabel('Corps HTML', { exact: true })
    .fill(
      '<h2>Bonjour Léa</h2><p>Votre intervention est confirmée.</p><img src="https://tracking.example.test/pixel"><a href="https://tracking.example.test/link">Lien</a><script>window.top.pulsarUnsafe = true</script>',
    );
  const preview = page.locator('iframe[title="Aperçu sécurisé du courriel"]');
  await expect(preview).toHaveAttribute('sandbox', '');
  await expect(
    page.frameLocator('iframe[title="Aperçu sécurisé du courriel"]').getByText('Bonjour Léa'),
  ).toBeVisible();
  const src = await preview.getAttribute('srcdoc');
  expect(src).toContain('Content-Security-Policy');
  expect(src).not.toContain('<script>');
  expect(src).not.toContain('href="https://tracking');
  await page.getByRole('button', { name: 'Aperçu mobile' }).click();
  await page.screenshot({ path: info.outputPath('template-preview.png'), fullPage: true });
  expect(remoteRequests).toBe(0);
  expect(
    await page.evaluate(() => (window as unknown as { pulsarUnsafe?: boolean }).pulsarUnsafe),
  ).toBeUndefined();
});

test('plain-text templates can be created, edited and reused without writing HTML', async ({
  page,
}) => {
  await login(page, credentials());
  await page.goto('/emails/templates');
  const name = `Suivi atelier ${Date.now()}`;
  await page.getByRole('button', { name: 'Nouveau gabarit', exact: true }).click();
  await page.getByLabel('Clé', { exact: true }).fill(`followup-${Date.now()}`);
  await page.getByLabel('Nom', { exact: true }).fill(name);
  await page.getByLabel('Sujet', { exact: true }).fill('Premier sujet');
  await page
    .getByLabel('Message du courriel', { exact: true })
    .fill('Bonjour Léa,\nVotre dossier <atelier> & ses pièces sont prêts.');
  const preview = page.frameLocator('iframe[title="Aperçu sécurisé du courriel"]');
  await expect(
    preview.getByText('Votre dossier <atelier> & ses pièces sont prêts.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Modifier', exact: true }).click();
  await page.getByLabel('Sujet', { exact: true }).fill('Sujet corrigé');
  await page.getByRole('button', { name: 'Mettre à jour', exact: true }).click();
  await expect(row).toContainText('Sujet corrigé');
  await page.goto('/emails');
  await page.getByRole('button', { name: 'Composer', exact: true }).click();
  await page.getByLabel('Gabarit (optionnel)').selectOption({ label: name });
  await expect(page.getByLabel('Sujet', { exact: true })).toHaveValue('Sujet corrigé');
  await expect(
    page
      .frameLocator('iframe[title="Aperçu sécurisé du courriel"]')
      .getByText('Bonjour Léa,', { exact: false }),
  ).toBeVisible();
});
