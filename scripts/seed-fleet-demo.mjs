/** Explicit local-only demo. No reset, no mutation of pre-existing assets. */
const base = new URL(process.env.PULSAR_API_URL || 'http://localhost:3100/api/v1/');
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
  !['http:', 'https:'].includes(base.protocol)
)
  throw new Error('API locale uniquement.');
if (!process.argv.includes('--create')) {
  console.log('Usage : node scripts/seed-fleet-demo.mjs --create (tenant acme par défaut).');
  process.exit(0);
}
let token;
async function api(path, body) {
  const r = await fetch(new URL(base.toString().replace(/\/$/, '') + '/' + path), {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : undefined;
}
token = (
  await api('auth/login', {
    tenant: process.env.PULSAR_DEMO_TENANT || 'acme',
    email: process.env.PULSAR_DEMO_EMAIL || 'admin@pulsar.dev',
    password: process.env.PULSAR_DEMO_PASSWORD || 'admin123',
  })
).accessToken;
let existingTruck;
for (const kind of ['vehicles', 'trailers']) {
  const existing = await api(`transportation/${kind}?search=DEMO-FLT&pageSize=100`);
  if (existing.total) {
    if (
      process.argv.includes('--resume-empty') &&
      kind === 'vehicles' &&
      existing.total === 1 &&
      existing.items[0].unitNumber === 'DEMO-FLT-101'
    ) {
      const asset = existing.items[0];
      const detail = await api(`fleet/workspace/assets/vehicle/${asset.id}`);
      const schedules = await api(`fleet/maintenance-schedules?vehicleId=${asset.id}`);
      if (
        asset.status !== 'AVAILABLE' ||
        asset.plate !== 'DEMO101' ||
        asset.carrierId ||
        detail.orders.total ||
        detail.documents.total ||
        detail.transport?.items.length ||
        schedules.length
      )
        throw new Error('Actif déjà utilisé : reprise refusée.');
      existingTruck = asset;
      continue;
    }
    console.log(
      'Un scénario DEMO-FLT existe déjà : aucune mutation. Vérifiez les données avant une nouvelle installation. http://localhost:5173/fleet',
    );
    process.exit(0);
  }
}
const truck =
  existingTruck ??
  (await api('transportation/vehicles', {
    unitNumber: 'DEMO-FLT-101',
    type: 'TRACTOR',
    plate: 'DEMO101',
  }));
console.log(
  'Création du scénario fictif. En cas d’interruption, aucun reset ni reprise automatique.',
);
await api('transportation/vehicles', {
  unitNumber: 'DEMO-FLT-102',
  type: 'STRAIGHT_TRUCK',
  plate: 'DEMO102',
});
const trailer = await api('transportation/trailers', {
  unitNumber: 'DEMO-FLT-R01',
  type: 'DRY_VAN',
  plate: 'DEMOR01',
});
const day = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10) + 'T00:00:00.000Z';
for (const [description, dueDate] of [
  ['[DÉMO] Contrôle des freins', day(-1)],
  ['[DÉMO] Vidange et filtres', day(2)],
]) {
  await api('fleet/maintenance-orders', {
    vehicleId: truck.id,
    type: 'PREVENTIVE',
    description,
    dueDate,
    vendor: 'Atelier fictif — aucun rendez-vous réel',
  });
}
await api('fleet/maintenance-orders', {
  trailerId: trailer.id,
  type: 'INSPECTION',
  description: '[DÉMO] Inspection remorque — date à définir',
});
await api('fleet/compliance-documents', {
  subjectType: 'VEHICLE',
  subjectId: truck.id,
  docType: 'INSURANCE',
  reference: 'DÉMO — document fictif expiré',
  expiresAt: day(-3),
});
await api('fleet/maintenance-schedules', {
  vehicleId: truck.id,
  name: '[DÉMO] Entretien tous les 90 jours',
  type: 'PREVENTIVE',
  intervalDays: 90,
});
console.log(
  'Prêt : 2 véhicules, 1 remorque, 3 interventions, 1 document et 1 plan fictifs. http://localhost:5173/fleet',
);
