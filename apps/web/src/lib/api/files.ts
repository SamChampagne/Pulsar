import { getAccessToken } from '$lib/stores/auth';

const BASE = '/api/v1';

/** Multipart upload via DocumentsService. Returns the created document. */
export async function uploadDocument(
  file: File,
  entityType: string,
  entityId: string,
): Promise<{ id: string }> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('entityType', entityType);
  fd.append('entityId', entityId);
  const token = getAccessToken();
  const res = await fetch(`${BASE}/documents/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return (await res.json()) as { id: string };
}

/** Authenticated GET of a document's bytes → blob object URL (usable in CSS/img/iframe). */
export async function fetchDocumentObjectUrl(id: string): Promise<string> {
  const token = getAccessToken();
  const res = await fetch(`${BASE}/documents/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Authenticated download that actually saves the file. A plain <a href> to the
 * API can't carry the bearer token (SPA, no cookie) → 401, so we fetch the bytes
 * with the token then trigger a client-side save.
 */
export async function downloadDocument(id: string, fileName: string): Promise<void> {
  const url = await fetchDocumentObjectUrl(id);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'document';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a beat to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Submit a CSV import batch.
 * Sends multipart/form-data: file, target, mapping (JSON string).
 */
export async function submitCsvImport<T>(
  file: File,
  target: string,
  mapping: Record<string, string>,
): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('target', target);
  fd.append('mapping', JSON.stringify(mapping));
  const token = getAccessToken();
  const res = await fetch(`${BASE}/connect/imports`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const msg = Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : (payload?.message ?? res.statusText);
    throw new Error(msg);
  }
  return (await res.json()) as T;
}
