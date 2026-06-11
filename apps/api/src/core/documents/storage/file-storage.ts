import type { Readable } from 'node:stream';

/** Injection token for the configured storage driver (see DocumentsModule). */
export const FILE_STORAGE = 'FILE_STORAGE';

/**
 * Binary storage behind the documents service. Two drivers: local filesystem
 * (dev default) and S3-compatible. Feature code never touches the filesystem
 * or S3 directly — everything goes through DocumentsService (CLAUDE.md rule 12).
 */
export interface FileStorage {
  put(key: string, body: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Pre-signed GET URL, or null when the driver cannot pre-sign (local). */
  getDownloadUrl(key: string, expiresInSeconds: number): Promise<string | null>;
  /** Pre-signed PUT URL, or null when the driver cannot pre-sign (local). */
  getUploadUrl(key: string, mimeType: string, expiresInSeconds: number): Promise<string | null>;
}
