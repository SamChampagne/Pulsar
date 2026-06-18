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

/** Authenticated GET of a document's bytes → blob object URL (usable in CSS). */
export async function fetchDocumentObjectUrl(id: string): Promise<string> {
  const token = getAccessToken();
  const res = await fetch(`${BASE}/documents/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
