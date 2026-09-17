import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Authenticated smoke test with the release-notes endpoints mocked (see
 * fleet-workspace.spec.ts for the same login-then-route pattern): needs the
 * NestJS API + a seeded database for `login()`, but the feed itself is served
 * from `page.route` so the test doesn't depend on any actual release notes.
 */
const notes = [
  {
    id: 'rn-1',
    title: 'Nouveau tableau de bord',
    body: '**Amélioration** du tableau de bord.',
    bodyHtml: '<p><strong>Amélioration</strong> du tableau de bord.</p>',
    kind: 'FEATURE',
    version: '1.4.0',
    publishedAt: '2026-09-10T00:00:00Z',
  },
  {
    id: 'rn-2',
    title: 'Correction mineure',
    body: 'Correctif de stabilité.',
    bodyHtml: '<p>Correctif de stabilité.</p>',
    kind: 'FIX',
    version: null,
    publishedAt: '2026-09-05T00:00:00Z',
  },
];

/** Mocks the release-notes API, returning shared state the tests can inspect. */
async function mockReleaseNotes(page: Page) {
  const state = { seenCalled: false, unseenCount: 2 };
  await page.route('**/api/v1/release-notes/unseen-count', (route) =>
    route.fulfill({ json: { count: state.unseenCount } }),
  );
  await page.route('**/api/v1/release-notes/seen', (route) => {
    state.seenCalled = true;
    state.unseenCount = 0;
    return route.fulfill({ json: { seenAt: '2026-09-16T00:00:00Z' } });
  });
  await page.route('**/api/v1/release-notes', (route) =>
    route.fulfill({ json: { items: notes, total: notes.length, page: 1, pageSize: 20 } }),
  );
  return state;
}

test.describe("what's new feed", () => {
  test('shows the Sparkles badge when there are unseen notes', async ({ page }) => {
    await login(page);
    await mockReleaseNotes(page);

    await page.goto('/dashboard');
    const sparklesButton = page.getByRole('link', { name: 'Quoi de neuf' });
    await expect(sparklesButton).toBeVisible();
    await expect(sparklesButton.locator('.bg-danger')).toBeVisible();
  });

  test('opening /whats-new renders the notes, marks them seen, and clears the badge', async ({
    page,
  }) => {
    await login(page);
    const state = await mockReleaseNotes(page);

    await page.goto('/dashboard');
    const sparklesButton = page.getByRole('link', { name: 'Quoi de neuf' });
    await expect(sparklesButton.locator('.bg-danger')).toBeVisible();

    await sparklesButton.click();
    await page.waitForURL('**/whats-new');

    await expect(page.getByRole('heading', { name: 'Quoi de neuf' })).toBeVisible();
    await expect(page.getByText('Nouveau tableau de bord')).toBeVisible();
    await expect(page.getByText('Correction mineure')).toBeVisible();
    await expect(page.locator('strong', { hasText: 'Amélioration' })).toBeVisible();
    await expect.poll(() => state.seenCalled).toBe(true);

    // The layout's shared store is reset synchronously once the feed loads.
    await expect(sparklesButton.locator('.bg-danger')).toHaveCount(0);
  });
});
