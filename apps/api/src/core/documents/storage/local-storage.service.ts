import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { FileStorage } from './file-storage';

/**
 * Filesystem driver (dev/CI default). Files live under STORAGE_LOCAL_DIR
 * (relative to the API working directory). Pre-signed URLs are not available:
 * downloads degrade to the API streaming endpoint (see DocumentsService).
 */
export class LocalStorageService implements FileStorage {
  private readonly baseDir: string;

  constructor(config: ConfigService) {
    this.baseDir = resolve(config.get<string>('STORAGE_LOCAL_DIR', 'storage'));
  }

  /** Storage keys are generated server-side, but never trust them as paths. */
  private pathFor(key: string): string {
    const full = resolve(join(this.baseDir, key));
    // sep-anchored so a sibling like "<baseDir>-evil" cannot pass the check.
    if (!full.startsWith(this.baseDir + sep)) {
      throw new NotFoundException('Document not found');
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    if (!existsSync(path)) {
      throw new NotFoundException('Document binary is missing from storage');
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
  }

  async getDownloadUrl(): Promise<string | null> {
    return null;
  }

  async getUploadUrl(): Promise<string | null> {
    return null;
  }
}
