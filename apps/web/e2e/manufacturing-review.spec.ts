import { test, expect, type Page } from '@playwright/test';
import { EXPERIENCED_PREFERENCES } from './helpers';

// Deterministic UI contract tests. The API/tenant authorization is covered by the HTTP suite.
async function setup(page: Page, readonly = false) {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.addInitScript((readonly) => {
    localStorage.setItem(
      'pulsar.auth',
      JSON.stringify({
        accessToken: 'ui-contract-fixture',
        refreshToken: '',
        user: {
          id: 'fixture',
          firstName: 'Test',
          lastName: 'APS',
          email: 'fixture@example.test',
          permissions: ['manufacturing.read', ...(readonly ? [] : ['manufacturing.manage'])],
        },
        tenant: {
          id: 'fixture',
          name: 'Atelier démo',
          slug: 'fixture',
          enabledModules: ['manufacturing'],
        },
      }),
    );
  }, readonly);
  const run = {
    id: 'candidate',
    strategy: 'greedy',
    solverStatus: 'feasible',
    objectiveValue: 0,
    wallTimeMs: 12,
    orderCount: 1,
    operationCount: 1,
    assignmentCount: 1,
    isBaseline: false,
    warnings: [],
    createdAt: '2026-01-05T14:00:00Z',
    timeZone: 'America/Toronto',
    horizonStart: '2026-01-05T05:00:00Z',
    horizonEnd: '2026-01-12T05:00:00Z',
    assignments: [
      {
        id: 'a',
        operationId: 'op',
        orderId: 'order',
        workCenterId: 'm',
        setupStart: '2026-01-05T13:00:00Z',
        start: '2026-01-05T13:00:00Z',
        end: '2026-01-05T17:00:00Z',
      },
    ],
    inputRequest: {
      snapshot: {
        machines: [{ id: 'm', name: 'Découpe laser' }],
        work_orders: [
          {
            id: 'order',
            name: 'OF-1042 · Panneaux acier',
            operations: [{ id: 'op', name: 'Découpe panneaux' }],
          },
        ],
      },
    },
  };
  const state = {
    run,
    writes: [] as { path: string; body: any }[],
    reviewFailure: false,
    status: 'publishable',
    uncertain: false,
    publishDelay: 0,
  };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1/', '');
    if (path === 'me/preferences') return route.fulfill({ json: EXPERIENCED_PREFERENCES });
    if (route.request().method() !== 'GET') {
      state.writes.push({ path, body: route.request().postDataJSON() });
      if (path.endsWith('/publish')) {
        if (state.publishDelay)
          await new Promise((resolve) => setTimeout(resolve, state.publishDelay));
        run.isBaseline = true;
        if (state.uncertain) return route.abort('failed');
      }
      return route.fulfill({ json: run });
    }
    if (path.endsWith('/review'))
      return state.reviewFailure
        ? route.fulfill({ status: 503, json: { message: 'Moteur APS indisponible' } })
        : route.fulfill({
            json: {
              runId: run.id,
              baselineId: 'baseline',
              timeZone: run.timeZone,
              canPublish: state.status === 'publishable',
              reviewToken: 'a'.repeat(64),
              blockers:
                state.status === 'publishable'
                  ? []
                  : ['Les ordres ont changé. Recalculez le scénario.'],
              assessment: {
                publish_status: state.status,
                recommendation: 'Comparaison fournie par le moteur APS.',
                comparison: {
                  metric_delta: {
                    makespan_minutes: -60,
                    total_lateness_minutes: -30,
                    on_time_ratio: null,
                  },
                  stability_report: {
                    changed_operation_count: 2,
                    machine_change_count: 1,
                    introduced_operation_count: 0,
                    removed_operation_count: 0,
                  },
                },
              },
            },
          });
    if (path === 'manufacturing/scheduling/runs')
      return route.fulfill({ json: { items: [run], total: 1, page: 1, pageSize: 50 } });
    if (path === 'manufacturing/scheduling/runs/candidate') return route.fulfill({ json: run });
    if (path === 'manufacturing/work-centers')
      return route.fulfill({
        json: {
          items: [{ id: 'm', code: 'LAS', name: 'Nom actuel' }],
          total: 1,
          page: 1,
          pageSize: 100,
        },
      });
    return route.fulfill({ json: path === 'notifications' ? [] : {} });
  });
  await page.goto('/manufacturing/scheduling');
  await expect(page.getByText('Découpe laser', { exact: true })).toBeVisible();
  return state;
}

test('Pulsar drawer preserves layout, keyboard focus, explicit timezone and captured labels', async ({
  page,
}) => {
  const state = await setup(page);
  const button = page.getByRole('button', { name: 'Nouveau scénario', exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau scénario' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Fuseau des calendriers (IANA)').fill('America/Toronto');
  await page.getByLabel('Date de début locale').fill('2026-03-08');
  await page.getByLabel('Horizon (jours)').fill('1');
  await expect(dialog).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/manufacturing-settings.png', fullPage: true });
  await page.getByRole('button', { name: 'Calculer le scénario', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes[0].body).toEqual({
    strategy: 'greedy',
    horizonDays: 1,
    horizonDate: '2026-03-08',
    timeZone: 'America/Toronto',
  });
  await button.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('review is read-only and confirmation submits the exact review token once', async ({
  page,
}) => {
  const state = await setup(page);
  state.publishDelay = 300;
  await page.getByRole('button', { name: 'Revoir le scénario' }).click();
  await expect(page.getByText(/Prêt à publier/)).toBeVisible();
  await expect(page.getByText('Non disponible', { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await expect(page.getByRole('dialog', { name: 'Revue avant publication' })).toHaveCSS(
    'opacity',
    '1',
  );
  await page.screenshot({ path: 'test-results/manufacturing-review.png', fullPage: true });
  const publish = page.getByRole('button', { name: 'Confirmer la publication' });
  await publish.click();
  await expect(publish).toBeDisabled();
  await expect(page.getByText(/Plan publié/)).toBeVisible();
  expect(state.writes).toEqual([
    {
      path: 'manufacturing/scheduling/runs/candidate/publish',
      body: { reviewToken: 'a'.repeat(64) },
    },
  ]);
});

test('review-only and unavailable engine never enable publication', async ({ page }) => {
  const state = await setup(page);
  state.status = 'review';
  await page.getByRole('button', { name: 'Revoir le scénario' }).click();
  await expect(page.getByRole('button', { name: 'Confirmer la publication' })).toBeDisabled();
  await expect(page.getByText('Les ordres ont changé. Recalculez le scénario.')).toBeVisible();
  state.reviewFailure = true;
  await page.getByRole('button', { name: 'Actualiser la revue' }).click();
  await expect(page.getByRole('alert')).toContainText('Moteur APS indisponible');
  await expect(page.getByRole('button', { name: 'Confirmer la publication' })).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});

test('uncertain publication is inspected instead of resent', async ({ page }) => {
  const state = await setup(page);
  state.uncertain = true;
  await page.getByRole('button', { name: 'Revoir le scénario' }).click();
  await page.getByRole('button', { name: 'Confirmer la publication' }).click();
  await expect(page.getByRole('button', { name: 'Confirmer la publication' })).toBeDisabled();
  await page.getByRole('button', { name: 'Vérifier l’état' }).click();
  await expect(page.getByText(/Plan publié/)).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test('read-only permission can review but cannot calculate or publish', async ({ page }) => {
  const state = await setup(page, true);
  await expect(page.getByRole('button', { name: 'Nouveau scénario', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoir le scénario' }).click();
  await expect(page.getByText(/Prêt à publier/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmer la publication' })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('narrow workspace and drawer stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 810, height: 1080 });
  await setup(page);
  await page.getByRole('button', { name: 'Revoir le scénario' }).click();
  await expect(page.getByText(/Prêt à publier/)).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Revue avant publication' });
  await expect
    .poll(async () => {
      const bounds = await dialog.boundingBox();
      return bounds ? bounds.x >= 0 && bounds.x + bounds.width <= 811 : false;
    })
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Confirmer la publication' })).toBeInViewport();
});
