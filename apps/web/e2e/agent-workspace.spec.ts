import { test, expect } from './fixtures';
import { EXPERIENCED_PREFERENCES } from './helpers';

test.use({ reducedMotion: 'reduce' });

test('global workspace: concurrent workers, history, model, close/reopen and mobile', async ({
  page,
}, info) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'pulsar.auth',
      JSON.stringify({
        accessToken: 'fixture',
        refreshToken: 'fixture',
        user: {
          id: 'u',
          firstName: 'Camille',
          lastName: 'Test',
          email: 'ui@example.invalid',
          permissions: ['core.agents.chat'],
        },
        tenant: { id: 't', name: 'Entreprise de recette', slug: 'fixture', enabledModules: [] },
      }),
    ),
  );
  const workers = [
    {
      id: 'logistics',
      name: 'Camille · Opérations',
      role: 'Suivi des dossiers',
      model: 'fixture-logistics',
      status: 'ACTIVE',
    },
    {
      id: 'finance',
      name: 'Alex · Finance',
      role: 'Revue financière',
      model: 'fixture-finance',
      status: 'ACTIVE',
    },
    { id: 'paused', name: 'Worker en pause', role: '', model: 'fixture', status: 'PAUSED' },
  ];
  let count = 0;
  const started: string[] = [];
  const history = [{ id: 'old', agentId: 'logistics', title: 'Dossier de la veille' }];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/agent-conversations/workers')) return route.fulfill({ json: workers });
    if (path.endsWith('/agent-conversations')) {
      if (request.method() === 'POST') {
        const id = `new-${++count}`;
        history.unshift({
          id,
          agentId: request.postDataJSON().agentId,
          title: `Discussion ${count}`,
        });
        return route.fulfill({ json: { id } });
      }
      return route.fulfill({ json: history });
    }
    if (path.endsWith('/old'))
      return route.fulfill({
        json: { messages: [{ role: 'assistant', content: 'Historique conservé.' }] },
      });
    if (path.endsWith('/messages')) {
      started.push(path);
      await gate;
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'event: text\ndata: {"text":"Analyse de recette terminée."}\n\nevent: result\ndata: {"result":{"version":1,"status":"succeeded"}}\n\nevent: end\ndata: {}\n\n',
      });
    }
    return route.fulfill({
      json: path.endsWith('/preferences')
        ? EXPERIENCED_PREFERENCES
        : path.endsWith('/unseen-count')
          ? { count: 0 }
          : [],
    });
  });
  try {
    await page.goto('/apps');
    await page.getByRole('button', { name: 'Assistant IA', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Espace IA' });
    await expect(
      dialog.getByText('Modèle configuré : fixture-logistics', { exact: false }),
    ).toBeVisible();
    await expect(dialog.getByRole('link', { name: /Configurer/ })).toHaveCount(0); // chat-only role
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath('workspace-empty.png'), animations: 'disabled' });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    await page.screenshot({ path: info.outputPath('workspace-dark.png'), animations: 'disabled' });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'warm';
    });
    await dialog
      .getByRole('textbox', { name: 'Message au worker' })
      .fill('Vérifier mes dossiers logistiques.');
    await dialog.getByRole('button', { name: 'Envoyer au worker' }).click();
    await expect.poll(() => started.length).toBe(1);
    await dialog.getByLabel('Worker', { exact: true }).selectOption('finance');
    await expect(dialog.getByText(/Modèle configuré : fixture-finance/)).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Message au worker' }).fill('Revoir les factures.');
    await dialog.getByRole('button', { name: 'Envoyer au worker' }).click();
    await expect.poll(() => started.length).toBe(2);
    await expect(dialog.getByText('2 conversations en cours', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('workspace-parallel.png') });
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel('2 conversations en cours')).toBeVisible();
    release();
    await page.getByRole('button', { name: 'Assistant IA', exact: true }).click();
    await expect(dialog.getByText('Réponse terminée', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: /Vérifier mes dossiers logistiques/ }).click();
    await expect(dialog.getByText('Analyse de recette terminée.', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: /Dossier de la veille/ }).click();
    await expect(dialog.getByText('Historique conservé.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Nouvelle conversation', exact: true }).last().click();
    await dialog.getByRole('textbox', { name: 'Message au worker' }).fill('Brouillon à conserver');
    await dialog.getByLabel('Worker', { exact: true }).selectOption('finance');
    await dialog
      .getByRole('navigation', { name: 'Conversations IA' })
      .getByRole('button', { name: /Nouvelle conversation/ })
      .click();
    await expect(dialog.getByRole('textbox', { name: 'Message au worker' })).toHaveValue(
      'Brouillon à conserver',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.getByRole('button', { name: 'Ouvrir l’historique' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('workspace-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await dialog.getByRole('button', { name: 'Ouvrir l’historique' }).click();
    await expect(dialog.getByRole('button', { name: /Dossier de la veille/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Assistant IA', exact: true })).toBeFocused();
  } finally {
    release();
  }
});

test('global workspace: errors are explicit, empty roster does not loop requests', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'pulsar.auth',
      JSON.stringify({
        accessToken: 'fixture',
        user: { id: 'u', firstName: 'Test', permissions: ['core.agents.chat'] },
        tenant: { id: 't', slug: 'fixture', enabledModules: [] },
      }),
    ),
  );
  let rosterCalls = 0;
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/workers')) {
      rosterCalls++;
      return route.fulfill({ status: 503, json: { message: 'Service de recette indisponible.' } });
    }
    return route.fulfill({ json: path.endsWith('/preferences') ? EXPERIENCED_PREFERENCES : [] });
  });
  await page.goto('/apps');
  await page.getByRole('button', { name: 'Assistant IA', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Espace IA' });
  await expect(dialog.getByRole('alert')).toContainText('Service de recette indisponible.');
  expect(rosterCalls).toBe(1);
  await expect(dialog.getByRole('textbox', { name: 'Message au worker' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Réessayer le chargement' }).click();
  await expect.poll(() => rosterCalls).toBe(2);
});
