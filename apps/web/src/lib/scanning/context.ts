import type { ScanKind, ModuleKey, PermissionKey } from '@pulsar/shared';
export const SCAN_CONTEXTS: Record<
  string,
  { permission: PermissionKey; module: ModuleKey; kinds: { kind: ScanKind; label: string }[] }
> = {
  wms: {
    permission: 'wms.read',
    module: 'wms',
    kinds: [
      { kind: 'item', label: 'Article (code-barres ou SKU)' },
      { kind: 'bin', label: 'Emplacement (code)' },
    ],
  },
  transport: {
    permission: 'transportation.planning.read',
    module: 'transportation',
    kinds: [
      { kind: 'load', label: 'Chargement (numéro)' },
      { kind: 'shipment', label: 'Expédition (numéro)' },
    ],
  },
  manufacturing: {
    permission: 'manufacturing.read',
    module: 'manufacturing',
    kinds: [{ kind: 'manufacturing-order', label: 'Ordre de fabrication (numéro)' }],
  },
  yard: {
    permission: 'yard.read',
    module: 'yard',
    kinds: [
      { kind: 'yard-visit', label: 'Visite (numéro)' },
      { kind: 'dock-appointment', label: 'Rendez-vous (numéro)' },
    ],
  },
  fleet: {
    permission: 'fleet.read',
    module: 'fleet',
    kinds: [
      { kind: 'vehicle', label: 'Véhicule (unité, VIN ou plaque)' },
      { kind: 'trailer', label: 'Remorque (unité ou plaque)' },
    ],
  },
};
export function pickerScanContext(endpoint: string, filters: Record<string, string>) {
  if (['/wms/choices/items', '/wms/items'].includes(endpoint)) return { kind: 'item' as const };
  const site = endpoint.match(/^\/wms\/sites\/([^/]+)\/bins$/);
  if (site) return { kind: 'bin' as const, locationId: decodeURIComponent(site[1]) };
  if (endpoint === '/wms/bins') return { kind: 'bin' as const, locationId: filters.locationId };
  return null;
}
