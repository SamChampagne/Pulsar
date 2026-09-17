// ============================================================================
// Inbound webhook receiver — target catalog (pure data, browser-safe).
//
// A partner POSTs an arbitrary JSON payload on /public/hooks/:inboundToken; the
// integration's `config.target` says WHICH business write that payload feeds.
// Everything the receiver needs to gate the call lives here:
//   - `module`   the module that must be enabled for the tenant (rule 15);
//                `undefined` = core surface (locations), never gated.
//   - `permission` re-checked against the acting principal (rule 13): the hook
//                runs as the tenant service-account scoped to this single
//                permission, so a receiver can never write outside its target.
//   - `naturalKey` the tenant-unique field an `*.upsert` matches on.
// ============================================================================

import { MODULE_KEYS, type ModuleKey } from '../modules';

export type InboundHookTargetKey =
  | 'transport-order.create'
  | 'location.upsert'
  | 'customer.upsert'
  | 'carrier.upsert'
  | 'item.upsert';

export const INBOUND_HOOK_TARGET_KEYS: InboundHookTargetKey[] = [
  'transport-order.create',
  'location.upsert',
  'customer.upsert',
  'carrier.upsert',
  'item.upsert',
];

export interface InboundHookTarget {
  key: InboundHookTargetKey;
  label: string;
  /** Module gated by rule 15; `undefined` for core entities (locations). */
  module?: ModuleKey;
  /** Permission re-checked on the acting principal before the write. */
  permission: string;
  /** Tenant-unique field used by `*.upsert` (absent for create-only targets). */
  naturalKey?: string;
}

export const INBOUND_HOOK_TARGETS: InboundHookTarget[] = [
  {
    key: 'transport-order.create',
    label: 'Commande de transport (création)',
    module: MODULE_KEYS.TRANSPORTATION,
    permission: 'transportation.orders.manage',
  },
  {
    key: 'location.upsert',
    label: 'Lieu (création/mise à jour)',
    permission: 'core.locations.manage',
    naturalKey: 'code',
  },
  {
    key: 'customer.upsert',
    label: 'Client (création/mise à jour)',
    module: MODULE_KEYS.TRANSPORTATION,
    permission: 'transportation.master-data.manage',
    naturalKey: 'code',
  },
  {
    key: 'carrier.upsert',
    label: 'Transporteur (création/mise à jour)',
    module: MODULE_KEYS.TRANSPORTATION,
    permission: 'transportation.master-data.manage',
    naturalKey: 'code',
  },
  {
    key: 'item.upsert',
    label: 'Article WMS (création/mise à jour)',
    module: MODULE_KEYS.WMS,
    permission: 'wms.manage',
    naturalKey: 'sku',
  },
];

export function getInboundHookTarget(key: string): InboundHookTarget | undefined {
  return INBOUND_HOOK_TARGETS.find((t) => t.key === key);
}
