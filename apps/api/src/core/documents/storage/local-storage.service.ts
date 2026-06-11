import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { FileStorage } from './file-storage';

/**
 * Local-filesystem storage driver (dev default). Files live under
 * STORAGE_LOCAL_DIR, resolved from the API working directory. No pre-signed
 * URLs: downloads degrade to the API streaming endpoint and direct uploads are
 * refused (DocumentsService handles the null return).
 */
@Injectable()
export class LocalStorageService implements FileStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('STORAGE_LOCAL_DIR', 'storage'));
  }

  private pathFor(key: string): string {
    // Keys are server-generated (tenantId/entity/...), but guard against traversal anyway.
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Invalid storage key');
    }
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(key: string): Promise<Readable> {
    return createReadStream(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async getDownloadUrl(): Promise<string | null> {
    return null;
  }

  async getUploadUrl(): Promise<string | null> {
    return null;
  }
}
