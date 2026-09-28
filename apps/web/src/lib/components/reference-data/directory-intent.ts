import { validateDirectoryEntry, type DirectoryEntryData } from '@pulsar/shared';
export interface DirectoryIntent {
  id: string | null;
  body: {
    operationKey: string;
    expectedVersion?: number;
    entry: DirectoryEntryData;
    reason: string;
  };
}
const key = (scope: string) => `pulsar.directory.pending.v1:${scope}`;
export function readDirectoryIntent(scope: string): DirectoryIntent | null {
  const raw = sessionStorage.getItem(key(scope));
  if (!raw) return null;
  let v: DirectoryIntent;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new Error('Demande conservée illisible. Vérifiez le carnet avant toute nouvelle saisie.');
  }
  const b = v?.body;
  if (
    !b ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      b.operationKey,
    ) ||
    (v.id !== null &&
      (typeof v.id !== 'string' ||
        !/^[\w-]{1,100}$/.test(v.id) ||
        !Number.isInteger(b.expectedVersion) ||
        b.expectedVersion! < 1)) ||
    (v.id === null && b.expectedVersion !== undefined) ||
    typeof b.reason !== 'string' ||
    b.reason.trim().length < 3 ||
    b.reason.length > 500 ||
    !validateDirectoryEntry(b.entry).value
  )
    throw new Error('Demande conservée invalide. Vérifiez le carnet avant toute nouvelle saisie.');
  return v;
}
export function rememberDirectoryIntent(scope: string, intent: DirectoryIntent) {
  if (readDirectoryIntent(scope)) throw new Error('Une demande attend déjà confirmation.');
  sessionStorage.setItem(key(scope), JSON.stringify(intent));
}
export function clearDirectoryIntent(scope: string, operationKey: string) {
  if (readDirectoryIntent(scope)?.body.operationKey === operationKey)
    sessionStorage.removeItem(key(scope));
}
