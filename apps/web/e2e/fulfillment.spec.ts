import { test, expect, type APIRequestContext } from '@playwright/test';
import { login, DEMO_USER } from './helpers';

/**
 * Deep journey: the CRM → TMS "Prepare shipment" workflow, driven through the
 * real UI (desktop). Needs the API + a seeded DB reachable through the web
 * server's /api proxy (see playwright.config.ts). Data is prepared via the API
 * with unique codes (isolated test DB only); screenshots land under
 * apps/web/playwright-artifacts/fulfillment/ as review evidence.
 */

const SUFFIX = `PW-${Date.now().toString(36)}`;
const ART = 'playwright-artifacts/fulfillment';

async function api(request: APIRequestContext, token: string, method: 'post', url: string, data: unknown) {
  const res = await request[method](url, { headers: { Authorization: `Bearer ${token}` }, data });
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`);
  return res.json();
}

let seedCounter = 0;

async function seedConfirmedSalesOrder(request: APIRequestContext) {
  const uid = `${SUFFIX}-${seedCounter++}`;
  const login = await request.post('/api/v1/auth/login', {
    data: { email: DEMO_USER.email, password: DEMO_USER.password, tenant: DEMO_USER.tenant },
  });
  const token: string = (await login.json()).accessToken;

  const company = await api(request, token, 'post', '/api/v1/crm/companies', { name: `PW Co ${uid}` });
  const customer = await api(request, token, 'post', '/api/v1/transportation/customers', {
    code: `PWC-${uid}`,
    name: `PW Customer ${uid}`,
  });

  // Reuse two EXISTING locations from the same list the wizard loads (pageSize
  // 100, the API max) so the options are guaranteed present regardless of how
  // many locations the tenant already has. The seed always provides several.
  const locsRes = await request.get('/api/v1/transportation/locations?pageSize=100', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const locs = (await locsRes.json()).items as Array<{ id: string }>;
  if (locs.length < 2) throw new Error('need >=2 seeded locations for the fulfillment journey');

  const so = await api(request, token, 'post', '/api/v1/crm/sales-orders', {
    companyId: company.id, customerId: customer.id,
  });
  await api(request, token, 'post', `/api/v1/crm/sales-orders/${so.id}/confirm`, {});

  return {
    soId: so.id as string,
    soNumber: so.number as string,
    originId: locs[0].id,
    destId: locs[1].id,
  };
}

test.describe('CRM → TMS fulfillment journey', () => {
  test('prepare a shipment from a confirmed sales order, end to end', async ({ page, request }) => {
    const { soId, soNumber, originId, destId } = await seedConfirmedSalesOrder(request);

    await login(page);
    await page.goto(`/crm/sales-orders/${soId}`);

    // 3. The Expédition section is visible for a CONFIRMED order with a customer.
    const shipmentPanel = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Expédition' }) }).first();
    await expect(page.getByRole('heading', { name: 'Expédition' })).toBeVisible();
    const prepareBtn = page.getByRole('button', { name: "Préparer l'expédition" });
    await expect(prepareBtn).toBeVisible();
    await page.screenshot({ path: `${ART}/01-sales-order-shipment-panel.png`, fullPage: true });

    // 4-5. Open the wizard; check the fields/labels are present.
    await prepareBtn.click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText("Préparer l'expédition")).toBeVisible();
    await expect(page.getByLabel('Origine *')).toBeVisible();
    await expect(page.getByLabel('Destination *')).toBeVisible();
    await expect(page.getByLabel('Mode')).toBeVisible();
    await expect(page.getByLabel('Poids (kg)')).toBeVisible();

    // 6. Submitting without a physical measure is refused (client mirrors server).
    await page.getByLabel('Origine *').selectOption(originId);
    await page.getByLabel('Destination *').selectOption(destId);
    await page.getByRole('button', { name: "Créer l'ordre de transport" }).click();
    await expect(page.getByText(/mesure physique/i)).toBeVisible();

    // 7. Fill a measure and create.
    await page.getByLabel('Poids (kg)').fill('800');
    await page.screenshot({ path: `${ART}/02-wizard-filled.png` });
    await page.getByRole('button', { name: "Créer l'ordre de transport" }).click();

    // 8-9. Success: the panel now lists the created transport order (link).
    const toLink = page.locator('a[href^="/transport-orders/"]').first();
    await expect(toLink).toBeVisible();
    const toHref = await toLink.getAttribute('href');
    expect(toHref).toBeTruthy();

    // 10-12. Open the transport order; it links back to the sales order.
    await toLink.click();
    await page.waitForURL('**/transport-orders/**');
    await expect(page.getByText('Commande de vente (source)')).toBeVisible();
    const backLink = page.getByRole('link', { name: soNumber });
    await expect(backLink).toBeVisible();
    await page.screenshot({ path: `${ART}/03-transport-order-crm-link.png`, fullPage: true });

    // 13-15. Back to the sales order; create a SECOND shipment with a different
    // fulfillment key; both transport orders are listed, no duplicate.
    await backLink.click();
    await page.waitForURL(`**/crm/sales-orders/${soId}`);
    await page.getByRole('button', { name: "Préparer l'expédition" }).click();
    await page.getByLabel('Origine *').selectOption(originId);
    await page.getByLabel('Destination *').selectOption(destId);
    await page.getByLabel('Poids (kg)').fill('500');
    await page.getByLabel("Clé d'expédition").fill('backup');
    await page.getByRole('button', { name: "Créer l'ordre de transport" }).click();

    // Both transport orders are listed as exactly two DISTINCT orders (the panel
    // links + the success-line link may repeat an href, so assert on the set).
    const links = page.locator('a[href^="/transport-orders/"]');
    await expect(links.first()).toBeVisible();
    await expect
      .poll(async () => {
        const hrefs = await links.evaluateAll((els) =>
          els.map((e) => (e as HTMLAnchorElement).getAttribute('href')),
        );
        return new Set(hrefs.filter(Boolean)).size;
      })
      .toBe(2);
    void shipmentPanel;
  });

  test('wizard is usable on a tablet viewport (no horizontal overflow)', async ({ page, request }) => {
    const { soId, originId, destId } = await seedConfirmedSalesOrder(request);
    await page.setViewportSize({ width: 810, height: 1080 });
    await login(page);
    await page.goto(`/crm/sales-orders/${soId}`);

    await page.getByRole('button', { name: "Préparer l'expédition" }).click();
    await expect(page.getByLabel('Origine *')).toBeVisible();
    await page.getByLabel('Origine *').selectOption(originId);
    await page.getByLabel('Destination *').selectOption(destId);
    await page.screenshot({ path: `${ART}/04-wizard-tablet.png`, fullPage: true });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
