import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('configure a simulation, enroll a contact, pause/stop, and keep mobile contained', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  const suffix = `CRM UI ${Date.now()}`;
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('pulsar.auth')!));
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const crm = await page.request.patch('/api/v1/modules/crm', { headers, data: { enabled: true } });
  expect(crm.ok()).toBeTruthy();
  const contactResponse = await page.request.post('/api/v1/crm/contacts', {
    headers,
    data: { name: suffix, email: `ui-${Date.now()}@example.test` },
  });
  expect(contactResponse.ok()).toBeTruthy();

  await page.goto('/crm/sequences');
  await page.getByRole('button', { name: 'Nouveau scénario', exact: true }).click();
  await expect(page.getByLabel('Mode d’exécution')).toHaveValue('SIMULATION');
  await page.getByLabel('Nom du scénario').fill(suffix);
  await page.getByLabel('Délai après inscription (minutes)').fill('15');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enregistrer le scénario' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Scénario enregistré' })).toBeVisible();
  await page.reload();
  await page.getByRole('button').filter({ hasText: suffix }).click();
  await expect(page.getByLabel('Nom du scénario')).toHaveValue(suffix);
  await page.screenshot({ path: 'playwright-artifacts/crm-sequences-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator('aside')
        .first()
        .evaluate((el) => el.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: 'playwright-artifacts/crm-sequences-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/crm/contacts');
  await page.getByPlaceholder('Rechercher par nom…').fill(suffix);
  await page.getByPlaceholder('Rechercher par nom…').press('Enter');
  await page.getByRole('button', { name: suffix, exact: true }).click();
  const pane = page.getByRole('region', { name: 'Suivis automatiques' });
  const scenario = await page.request.get('/api/v1/crm/sequences', {
    headers,
    params: { search: suffix },
  });
  const scenarioId = (await scenario.json()).items[0].id;
  await pane.getByLabel('Scénario à démarrer').selectOption(scenarioId);
  await pane.getByRole('button', { name: 'Démarrer le suivi' }).click();
  await expect(pane.getByText('Simulation — aucun envoi', { exact: false })).toBeVisible();
  await pane.getByRole('button', { name: 'Mettre en pause' }).click();
  await expect(pane.getByText('En pause', { exact: true })).toBeVisible();
  await pane.getByRole('button', { name: 'Reprendre', exact: true }).click();
  await expect(pane.getByText('En cours', { exact: true })).toBeVisible();
  await pane.getByRole('button', { name: 'Arrêter définitivement' }).click();
  await expect(pane.getByText('Arrêté', { exact: true })).toBeVisible();
  const outbox = await page.request.get('/api/v1/emails', {
    headers,
    params: { relatedType: 'crm-sequence-step', search: suffix },
  });
  expect((await outbox.json()).total).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
  const item = (await scenario.json()).items[0];
  await page.request.put(`/api/v1/crm/sequences/${scenarioId}`, {
    headers,
    data: {
      name: item.name,
      enabled: false,
      mode: item.mode,
      trigger: item.trigger,
      steps: item.steps,
    },
  });
});

test('unsubscribe requires an explicit confirmation, never mutates on opening the link', async ({
  page,
}) => {
  let posts = 0;
  await page.route('**/api/v1/public/crm/unsubscribe', async (route) => {
    posts++;
    await route.fulfill({ json: { unsubscribed: true } });
  });
  await page.goto('/unsubscribe?token=abcdefghijklmnopqrstuvwxyz012345');
  await expect(
    page.getByRole('heading', { name: 'Arrêter les suivis par courriel' }),
  ).toBeVisible();
  expect(posts).toBe(0);
  await page.getByRole('button', { name: 'Confirmer le désabonnement' }).click();
  await expect(page.getByRole('heading', { name: 'Désabonnement enregistré' })).toBeVisible();
  expect(posts).toBe(1);
});
