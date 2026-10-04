import type { Route } from '@playwright/test';

/** Use only AFTER a scenario's owned routes. Newly mounted unrelated panels fail closed,
 * rather than receiving an invalid [] payload that silently crashes their rendering. */
export async function fulfillUnmockedDeliveryPanel(route: Route): Promise<boolean> {
  const path = new URL(route.request().url()).pathname;
  if (
    !/^\/api\/v1\/transportation\/(?:delivery-(?:packages|allocation|exceptions|fuel)(?:\/|$)|loads\/[^/]+\/(?:manifests|driver-documents)(?:\/|$))/.test(
      path,
    )
  )
    return false;
  await route.fulfill({
    status: 503,
    json: { message: 'Panneau hors du scénario simulé : lecture indisponible.' },
  });
  return true;
}
