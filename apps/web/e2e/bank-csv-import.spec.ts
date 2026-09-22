import { test, expect, type Page } from './fixtures';
import { inspectBankCsv } from '@pulsar/shared';
import { login } from './helpers';

const account = { id: 'csv-bank', name: 'Opérations CAD', glAccountCode: '1010', currency: 'CAD' };
const other = { ...account, id: 'csv-other', name: 'Réserve CAD' };
const sample =
  'date,description,amount,reference\n2026-09-14,Transport du Fjord,-135.08,FJ-218\n2026-09-15,Encaissement client,241.65,CL-32';
function preview(csv = sample, bankAccountId = account.id) {
  const p = inspectBankCsv(csv);
  return {
    bankAccountId,
    currency: 'CAD',
    previewHash: 'a'.repeat(64),
    canImport: !p.issues.length && !!p.rows.length,
    rows: p.rows.map((r) => ({ ...r, status: 'NEW' })),
    issues: p.issues,
    errors: p.errors,
    totals: {
      newCount: p.rows.length,
      duplicateCount: 0,
      invalidCount: p.issues.length,
      credits: 241.65,
      debits: 135.08,
    },
  };
}
test.beforeEach(async ({ page }) => {
  await login(page);
  await page.route('**/api/v1/billing/bank-accounts', (r) => r.fulfill({ json: [account, other] }));
  await page.route('**/api/v1/billing/bank-accounts/*/balance', (r) =>
    r.fulfill({ json: { balance: 0, txnCount: 0 } }),
  );
  await page.route('**/api/v1/billing/bank-transactions?**', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/v1/billing/bank-transactions/import/preview', (r) => {
    const body = r.request().postDataJSON();
    return r.fulfill({ json: preview(body.csv, body.bankAccountId) });
  });
  // Any test that sends an import must explicitly override this fail-closed route.
  await page.route('**/api/v1/billing/bank-transactions/import', (r) =>
    r.fulfill({ status: 500, json: { message: 'Unexpected test import.' } }),
  );
});
async function open(page: Page) {
  await page.goto('/billing/banking');
  await page.getByRole('tab', { name: 'Transactions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Importer un CSV' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Compte', exact: true }).selectOption(account.id);
  await page.getByRole('button', { name: 'Importer un CSV' }).click();
  return page.getByRole('dialog', { name: 'Importer un relevé CSV', exact: true });
}

test('file preview does not import, confirmation can be cancelled, success cannot be submitted twice', async ({
  page,
}) => {
  let writes = 0;
  await page.route('**/api/v1/billing/bank-transactions/import', (r) => {
    writes++;
    expect(r.request().postDataJSON()).toEqual({
      bankAccountId: account.id,
      csv: sample,
      previewHash: 'a'.repeat(64),
    });
    return r.fulfill({ json: { imported: 2, skipped: 0, errors: [] } });
  });
  const panel = await open(page);
  await panel
    .getByLabel('Fichier CSV (UTF-8)')
    .setInputFiles({ name: 'releve-fjord.csv', mimeType: 'text/csv', buffer: Buffer.from(sample) });
  await expect(panel.getByLabel('Contenu CSV')).toHaveValue(sample);
  await expect(panel.getByRole('button', { name: 'Importer', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Prévisualiser', exact: true }).click();
  await expect(panel.getByText('2 à importer · 0 doublon(s) · 0 erreur(s)')).toBeVisible();
  expect(writes).toBe(0);
  await panel.getByRole('button', { name: 'Importer', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Importer le relevé ?', exact: true });
  await expect(confirm).toContainText('Aucun paiement');
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  expect(writes).toBe(0);
  await panel.getByRole('button', { name: 'Importer', exact: true }).click();
  await confirm.getByRole('button', { name: 'Confirmer l’import', exact: true }).click();
  await expect(panel.getByText('Import terminé', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Importer', exact: true })).toHaveCount(0);
  expect(writes).toBe(1);
  await panel.getByRole('button', { name: 'Voir les mouvements' }).click();
  await expect(panel).toBeHidden();
});

test('invalid lines block the whole batch and edits invalidate the preview', async ({ page }) => {
  const panel = await open(page);
  await panel.getByLabel('Contenu CSV').fill(sample + '\n2026-02-30,Erreur,10,E');
  await panel.getByRole('button', { name: 'Prévisualiser', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Ligne 4');
  await expect(panel.getByRole('button', { name: 'Importer', exact: true })).toBeDisabled();
  await panel.getByLabel('Contenu CSV').fill(sample);
  await expect(panel.getByText('La saisie a changé.', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Prévisualiser', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Importer', exact: true })).toBeEnabled();
  await panel.getByLabel('Contenu CSV').fill(sample.replace('241.65', '241.66'));
  await expect(panel.getByRole('button', { name: 'Importer', exact: true })).toBeDisabled();
});

test('duplicates are explained and an already imported file cannot be submitted', async ({
  page,
}) => {
  await page.route('**/api/v1/billing/bank-transactions/import/preview', (r) =>
    r.fulfill({
      json: {
        ...preview(),
        canImport: false,
        rows: preview().rows.map((row, i) => ({
          ...row,
          status: i ? 'DUPLICATE_FILE' : 'DUPLICATE_EXISTING',
        })),
        totals: { newCount: 0, duplicateCount: 2, invalidCount: 0, credits: 0, debits: 0 },
      },
    }),
  );
  const panel = await open(page);
  await panel.getByLabel('Contenu CSV').fill(sample);
  await panel.getByRole('button', { name: 'Prévisualiser', exact: true }).click();
  await expect(panel.getByRole('cell', { name: 'Déjà présente', exact: true })).toBeVisible();
  await expect(panel.getByRole('cell', { name: 'Répétée dans le CSV', exact: true })).toBeVisible();
  await expect(panel.getByText(/Rien à importer/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Importer', exact: true })).toBeDisabled();
});

test('lost import response preserves content and safely retries the same payload', async ({
  page,
}) => {
  const bodies: unknown[] = [];
  await page.route('**/api/v1/billing/bank-transactions/import', (r) => {
    bodies.push(r.request().postDataJSON());
    return bodies.length === 1
      ? r.abort('failed')
      : r.fulfill({ json: { imported: 0, skipped: 2, errors: [] } });
  });
  const panel = await open(page);
  await panel.getByLabel('Contenu CSV').fill(sample);
  await panel.getByRole('button', { name: 'Prévisualiser', exact: true }).click();
  await panel.getByRole('button', { name: 'Importer', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Importer le relevé ?', exact: true })
    .getByRole('button', { name: 'Confirmer l’import' })
    .click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByLabel('Contenu CSV')).toHaveValue(sample);
  await panel.getByRole('button', { name: 'Importer', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Importer le relevé ?', exact: true })
    .getByRole('button', { name: 'Confirmer l’import' })
    .click();
  await expect(panel.getByText('0 mouvement(s) ajouté(s) · 2 doublon(s) ignoré(s).')).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});

test('close protects preparation and changing accounts requires a new preview', async ({
  page,
}) => {
  const panel = await open(page);
  await panel.getByLabel('Contenu CSV').fill(sample);
  await panel.getByRole('button', { name: 'Prévisualiser', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Importer', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog', { name: 'Fermer la préparation ?', exact: true });
  await confirm.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(panel.getByLabel('Contenu CSV')).toHaveValue(sample);
  await page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: 'Fermer la préparation', exact: true }).click();
  await page.getByRole('combobox', { name: 'Compte', exact: true }).selectOption(other.id);
  await page.getByRole('button', { name: 'Importer un CSV' }).click();
  await expect(panel.getByText(other.name, { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Contenu CSV')).toHaveValue(sample);
  await expect(panel.getByRole('button', { name: 'Importer', exact: true })).toBeDisabled();
});

test('oversize pasted content is preserved, never silently truncated', async ({ page }) => {
  const panel = await open(page),
    content = 'x'.repeat(30_001);
  await panel.getByLabel('Contenu CSV').fill(content);
  await expect(panel.getByLabel('Contenu CSV')).toHaveValue(content);
  await expect(panel.getByRole('alert')).toContainText('aucun contenu n’a été tronqué');
  await expect(panel.getByRole('button', { name: 'Prévisualiser', exact: true })).toBeDisabled();
});

test('mobile preview keeps navigation stable and import controls in reach', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = await open(page);
  await panel.getByLabel('Contenu CSV').fill(sample);
  await panel.getByRole('button', { name: 'Prévisualiser', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Importer', exact: true })).toBeEnabled();
  await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  const box = await panel.getByRole('button', { name: 'Importer', exact: true }).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'playwright-artifacts/bank-csv-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: 'playwright-artifacts/bank-csv-desktop.png', fullPage: true });
});
