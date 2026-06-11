import type { Readable } from 'node:stream';

/** DI token for the active file-storage driver (see STORAGE_DRIVER). */
export const FILE_STORAGE = Symbol('FILE_STORAGE');

/**
 * Storage abstraction selected by STORAGE_DRIVER (local | s3). Feature code must
 * always go through DocumentsService, never a driver directly (see CLAUDE.md).
 * Pre-signed URL methods return null when the driver cannot issue one (local),
 * in which case callers fall back to streaming through the API.
 */
export interface FileStorage {
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  getDownloadUrl(key: string, expiresInSeconds: number): Promise<string | null>;
  getUploadUrl(key: string, mimeType: string, expiresInSeconds: number): Promise<string | null>;
}
