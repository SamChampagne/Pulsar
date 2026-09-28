import { test, expect } from './fixtures';
import { login, tutorialAccount } from './helpers';

test('experienced-user login preserves account preferences without saving tutorial completion', async ({
  page,
  request,
}) => {
  const account = await tutorialAccount(request);
  const saved = await request.put('/api/v1/me/preferences', {
    headers: account.headers,
    data: { timeZone: 'America/Winnipeg' },
  });
  expect(saved.ok()).toBeTruthy();
  const before = await (
    await request.get('/api/v1/me/preferences', { headers: account.headers })
  ).json();

  await login(page, account.credentials);
  for (const path of ['/dashboard', '/documentation', '/dashboard']) {
    await page.goto(path);
    await expect(
      page.getByRole('button', { name: 'Fuseau utilisateur : America/Winnipeg', exact: true }),
    ).toBeVisible();
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.getByTestId('module-tour')).toHaveCount(0);
  }
  const after = await request.get('/api/v1/me/preferences', { headers: account.headers });
  expect(after.ok()).toBeTruthy();
  expect((await after.json()).moduleTours).toEqual(before.moduleTours);
});
