import { test, expect, type Page } from './fixtures';

const token = 'driver-document-fixture-only',
  ref = 'R'.repeat(43);
test.afterEach(async ({ page }) => {
  await page.goto('about:blank');
});
async function setup(
  page: Page,
  options: { ready?: boolean; message?: string; closed?: boolean } = {},
) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests: { method: string; path: string }[] = [];
  const state = { revoked: false, unavailable: false, badPdf: false, ready: options.ready ?? true };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    requests.push({ path, method });
    if (!path.startsWith(`/api/v1/public/driver/${token}`)) return route.fulfill({ json: [] });
    if (path.endsWith('/documents'))
      return state.unavailable
        ? route.fulfill({ status: 503, json: { message: 'Lecture indisponible.' } })
        : route.fulfill({
            json: {
              documents: options.message
                ? []
                : [
                    {
                      ref,
                      number: 'DL-00042',
                      revision: 2,
                      issuedAt: '2026-10-03T12:00:00.000Z',
                      ready: state.ready,
                    },
                  ],
              message: options.message ?? null,
            },
          });
    if (path.endsWith(`/${ref}/file`))
      return state.revoked
        ? route.fulfill({ status: 404, json: { message: 'Le lien a été révoqué.' } })
        : route.fulfill({
            contentType: state.badPdf ? 'text/html' : 'application/pdf',
            body: state.badPdf
              ? '<html>not a pdf</html>'
              : '%PDF-1.4\n% driver fixture only\n%%EOF',
          });
    if (path.endsWith('/packages'))
      return route.fulfill({
        json: {
          loadNumber: 'LD-DOCUMENT',
          status: options.closed ? 'COMPLETED' : 'IN_TRANSIT',
          updatedAt: '2026-10-03T12:00:00.000Z',
          shipments: [],
        },
      });
    return route.fulfill({
      json: {
        shipper: 'Atelier du Fleuve',
        carrier: null,
        loadNumber: 'LD-DOCUMENT',
        status: options.closed ? 'COMPLETED' : 'IN_TRANSIT',
        shipments: [],
        stops: [],
      },
    });
  });
  await page.goto(`/driver/${token}`);
  await expect(page.getByRole('heading', { name: 'LD-DOCUMENT' })).toBeVisible();
  return { state, requests };
}
const panel = (page: Page) => page.getByRole('region', { name: 'Document de tournée chauffeur' });

test('driver reads a published edition and downloads only through its capability route', async ({
  page,
}, info) => {
  const { requests } = await setup(page);
  await expect(panel(page)).toContainText('DL-00042');
  await expect(panel(page)).toContainText('Ni connaissement réglementaire, ni preuve de livraison');
  const download = page.waitForEvent('download');
  await panel(page).getByRole('button', { name: 'Télécharger le document de tournée' }).click();
  expect((await download).suggestedFilename()).toBe('DL-00042-r2.pdf');
  expect(requests.filter((r) => r.method !== 'GET')).toEqual([]);
  expect(requests.some((r) => r.path.endsWith('/bol'))).toBe(false);
  await page.screenshot({ path: info.outputPath('driver-document-mobile.png'), fullPage: true });
});
test('driver cannot generate an unprepared PDF', async ({ page }) => {
  const { requests } = await setup(page, { ready: false });
  await expect(panel(page)).toContainText('encore préparer le PDF');
  await expect(
    panel(page).getByRole('button', { name: 'Télécharger le document de tournée' }),
  ).toBeDisabled();
  expect(requests.some((r) => r.path.endsWith('/file'))).toBe(false);
});
test('changed mission hides obsolete document instead of offering the old BOL', async ({
  page,
}) => {
  await setup(page, {
    message: 'La mission a changé. Demandez une nouvelle publication à l’exploitation.',
  });
  await expect(panel(page)).toContainText('La mission a changé');
  await expect(panel(page).getByRole('button')).toHaveCount(0);
});
test('revocation during download produces an explicit error with no automatic retry', async ({
  page,
}) => {
  const { state, requests } = await setup(page);
  await expect(panel(page)).toContainText('DL-00042');
  state.revoked = true;
  await panel(page).getByRole('button', { name: 'Télécharger le document de tournée' }).click();
  await expect(panel(page).getByRole('alert')).toContainText('révoqué');
  expect(requests.filter((r) => r.path.endsWith('/file'))).toHaveLength(1);
  await expect(panel(page).getByRole('button')).toHaveCount(0);
});
test('invalid PDF response is never offered as a successful file', async ({ page }) => {
  const { state } = await setup(page);
  await expect(panel(page)).toContainText('DL-00042');
  state.badPdf = true;
  await panel(page).getByRole('button', { name: 'Télécharger le document de tournée' }).click();
  await expect(panel(page).getByRole('alert')).toContainText('Réponse de document invalide');
});
test('closed mission exposes no document listing or download control', async ({ page }) => {
  const { requests } = await setup(page, { closed: true });
  await expect(panel(page)).toHaveCount(0);
  expect(requests.some((r) => r.path.endsWith('/documents'))).toBe(false);
});
