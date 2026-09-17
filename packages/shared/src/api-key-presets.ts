import { ALL_PERMISSION_KEYS, PERMISSIONS, type PermissionKey } from './permissions';

/**
 * A named bundle of API key scopes offered in the "create API key" UI as a
 * starting point — the operator can still add/remove individual scopes after
 * picking one (see `settings/api-keys` web page). Pure data (browser-safe).
 */
export interface ApiKeyScopePreset {
  key: string;
  label: string;
  description: string;
  scopes: PermissionKey[];
}

/** Every permission key ending in `.read` — computed from the live catalog, never hand-listed. */
const READ_ONLY_SCOPES: PermissionKey[] = ALL_PERMISSION_KEYS.filter((key) =>
  key.endsWith('.read'),
);

export const API_KEY_SCOPE_PRESETS: ApiKeyScopePreset[] = [
  {
    key: 'read-only',
    label: 'Lecture seule',
    description: 'Accès en lecture à toutes les ressources activées pour le tenant.',
    scopes: READ_ONLY_SCOPES,
  },
  {
    key: 'orders-intake',
    label: 'Prise de commandes',
    description:
      'Création de commandes de transport, avec lecture des référentiels (clients, lieux, transporteurs, flotte) et des lieux du cœur.',
    scopes: [
      PERMISSIONS.TRANSPORTATION.ORDERS_MANAGE,
      PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ,
      PERMISSIONS.CORE.LOCATIONS_READ,
    ],
  },
  {
    key: 'tracking',
    label: 'Suivi',
    description: 'Lecture des événements de suivi (tracking) uniquement.',
    scopes: [PERMISSIONS.TRANSPORTATION.TRACKING_READ],
  },
];
