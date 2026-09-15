/** Local-only, explicit demo fixture. Uses business HTTP services, never direct balance writes. */
const base = new URL(process.env.PULSAR_API_URL || 'http://localhost:3100/api/v1/');
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
  !['http:', 'https:'].includes(base.protocol)
)
  throw new Error('Ce scénario est limité à une API locale.');
if (!process.argv.includes('--create')) {
  console.log(
    'Usage : node scripts/seed-wms-demo.mjs --create (API locale, tenant acme par défaut).',
  );
  process.exit(0);
}
const url = (path) => new URL(base.toString().replace(/\/$/, '') + '/' + path);
let token;
async function api(path, body) {
  const response = await fetch(url(path), {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} : HTTP ${response.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : undefined;
}
const tenant = process.env.PULSAR_DEMO_TENANT || 'acme';
token = (
  await api('auth/login', {
    tenant,
    email: process.env.PULSAR_DEMO_EMAIL || 'admin@pulsar.dev',
    password: process.env.PULSAR_DEMO_PASSWORD || 'admin123',
  })
).accessToken;
const code = 'DEMO-WMS-TRACE';
const sites = await api(`wms/sites?search=${code}`);
const existing = sites.items.find((s) => s.code === code);
if (existing) {
  console.log(
    `Le scénario existe déjà. Aucune donnée modifiée : http://localhost:5173/wms?site=${existing.id}`,
  );
  process.exit(0);
}
// Guard against partial earlier setup or foreign manually-created demo SKU collisions.
for (const sku of ['DEMO-WMS-KIT', 'DEMO-WMS-VRAC']) {
  const items = await api(`wms/items?search=${sku}`);
  if (items.items.some((i) => i.sku === sku))
    throw new Error(`Le SKU ${sku} existe déjà. Vérifiez le scénario avant de le relancer.`);
}
const site = await api('transportation/locations', {
  code,
  name: 'DÉMO WMS — Atelier de rangement',
  type: 'WAREHOUSE',
  addressLine1: 'Site fictif — démonstration uniquement',
  city: 'Démo',
  country: 'CA',
});
console.log(
  `Site de démonstration créé dans ${tenant} : ${site.id}. En cas d’interruption, aucun reset automatique.`,
);
const bins = [];
for (const [code, kind, zone] of [
  ['DEMO-RC', 'RECEIVING', 'DÉMO — Réception'],
  ['DEMO-A', 'STORAGE', 'DÉMO — Allée A'],
  ['DEMO-EX', 'SHIPPING', 'DÉMO — Expédition'],
])
  bins.push(await api('wms/bins', { locationId: site.id, code, kind, zone }));
const kit = await api('wms/items', {
  sku: 'DEMO-WMS-KIT',
  name: 'DÉMO — Ensemble de pièces fictif',
  unit: 'EA',
});
const bulk = await api('wms/items', {
  sku: 'DEMO-WMS-VRAC',
  name: 'DÉMO — Matière en vrac fictive',
  unit: 'KG',
});
const receipt = await api('wms/receipts', {
  locationId: site.id,
  reference: '[DÉMO WMS] Stock initial',
  note: 'Données fictives. Ranger depuis DEMO-RC vers DEMO-A puis préparer quatre ensembles.',
});
await api(`wms/receipts/${receipt.id}/lines`, { itemId: kit.id, toBinId: bins[0].id, qty: 17 });
await api(`wms/receipts/${receipt.id}/lines`, { itemId: bulk.id, toBinId: bins[0].id, qty: 2.125 });
await api(`wms/receipts/${receipt.id}/post`, {});
const pick = await api('wms/pick-orders', {
  locationId: site.id,
  reference: '[DÉMO WMS] Préparer quatre ensembles',
  note: 'Le manque est volontaire : ranger au moins quatre ensembles dans DEMO-A avant de finaliser.',
});
await api(`wms/pick-orders/${pick.id}/lines`, { itemId: kit.id, fromBinId: bins[1].id, qty: 4 });
const draft = await api('wms/receipts', {
  locationId: site.id,
  reference: '[DÉMO WMS] Réception à valider',
  note: 'Réception fictive supplémentaire pour essayer le parcours complet.',
});
await api(`wms/receipts/${draft.id}/lines`, { itemId: kit.id, toBinId: bins[0].id, qty: 8 });
console.log(
  JSON.stringify(
    {
      workspace: `http://localhost:5173/wms?site=${site.id}`,
      putaway: `http://localhost:5173/wms/putaway?site=${site.id}`,
      receipt: receipt.number,
      draft: draft.number,
      preparation: pick.number,
      preparationUrl: `http://localhost:5173/wms/picking/${pick.id}`,
    },
    null,
    2,
  ),
);
