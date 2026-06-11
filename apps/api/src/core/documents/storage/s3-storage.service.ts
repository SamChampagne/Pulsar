import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Readable } from 'node:stream';
import type { FileStorage } from './file-storage';

/**
 * S3-compatible storage driver (AWS S3, MinIO, Cloudflare R2...). Issues
 * pre-signed download and direct PUT upload URLs so large files bypass the API.
 * Set S3_ENDPOINT + S3_FORCE_PATH_STYLE for non-AWS providers.
 */
@Injectable()
export class S3StorageService implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    const endpoint = config.get<string>('S3_ENDPOINT');
    const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
    this.client = new S3Client({
      region: config.get<string>('S3_REGION', 'us-east-1'),
      forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
      ...(endpoint ? { endpoint } : {}),
      // Fall back to the default AWS credential chain when no static keys are set.
      ...(accessKeyId
        ? {
            credentials: {
              accessKeyId,
              secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
            },
          }
        : {}),
    });
  }

  async put(key: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: mimeType }),
    );
  }

  async get(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  getDownloadUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  getUploadUrl(key: string, mimeType: string, expiresInSeconds: number): Promise<string | null> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType }),
      { expiresIn: expiresInSeconds },
    );
  }
}
