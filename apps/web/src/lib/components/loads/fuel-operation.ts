import {
  validateDeliveryFuelActual,
  validateDeliveryFuelPrice,
  validateDeliveryFuelProfile,
} from '@pulsar/shared';

export type FuelIntent = {
  kind: 'profile' | 'price' | 'actual';
  endpoint: string;
  body: Record<string, unknown> & { operationKey: string; expectedRevision: number };
};
const base = '/transportation/delivery-fuel';
export const fuelOperationStorageKey = (scope: string) =>
  `pulsar.delivery-fuel.pending.v1:${scope}`;

/** Restoration never trusts an arbitrary endpoint or an unknown body from browser storage. */
export function parseFuelIntent(raw: string, loadId: string): FuelIntent {
  const v = JSON.parse(raw) as FuelIntent;
  if (
    !v ||
    Object.keys(v).some((k) => !['kind', 'endpoint', 'body'].includes(k)) ||
    !v.body ||
    Array.isArray(v.body)
  )
    throw Error('Demande conservée invalide.');
  const b = v.body;
  if (
    typeof b.operationKey !== 'string' ||
    !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(b.operationKey) ||
    !Number.isInteger(b.expectedRevision) ||
    b.expectedRevision < 0 ||
    b.expectedRevision > 2147483646
  )
    throw Error('Identité de demande invalide.');
  let keys: string[];
  if (
    v.kind === 'profile' &&
    new RegExp(`^${base}/vehicles/[A-Za-z0-9_-]+/profile$`).test(v.endpoint)
  ) {
    validateDeliveryFuelProfile(b.profile);
    keys = ['operationKey', 'expectedRevision', 'profile'];
  } else if (v.kind === 'price' && v.endpoint === `${base}/prices`) {
    validateDeliveryFuelPrice(b.price);
    keys = ['operationKey', 'expectedRevision', 'price'];
  } else if (
    v.kind === 'actual' &&
    v.endpoint === `${base}/loads/${encodeURIComponent(loadId)}/actuals`
  ) {
    validateDeliveryFuelActual(b.actual);
    for (const k of ['expectedLoadUpdatedAt', 'expectedRouteUpdatedAt'])
      if (typeof b[k] !== 'string' || !Number.isFinite(Date.parse(b[k] as string)))
        throw Error('Version de tournée absente.');
    keys = [
      'operationKey',
      'expectedRevision',
      'expectedLoadUpdatedAt',
      'expectedRouteUpdatedAt',
      'actual',
    ];
  } else throw Error('Portée de la demande conservée invalide.');
  if (Object.keys(b).some((k) => !keys.includes(k))) throw Error('Champ conservé inconnu.');
  return v;
}
