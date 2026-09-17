import { PayloadTooLargeException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Same ceiling as {@link MAX_EDI_BYTES} — refused before anything is buffered. */
const MAX_TEXT_BYTES = 512 * 1024;

/** Content types an EDI partner posts an interchange with. */
const TEXT_CONTENT_TYPE = /^(text\/|application\/(edi-x12|edifact|octet-stream))/i;

/**
 * Nest registers only the JSON and urlencoded body parsers (see
 * `ExpressAdapter.registerParserMiddleware`), so a `text/plain` interchange
 * would reach the controller as an empty object and `req.rawBody` would be
 * undefined — breaking both the EDI intake and the HMAC of the public receiver.
 *
 * This middleware buffers such a body ONCE, exposing it as:
 *  - `req.body`    — the decoded string (what `@Body()` hands the controller);
 *  - `req.rawBody` — the exact bytes (what the HMAC is computed over).
 *
 * It is a no-op when an earlier parser already consumed the body (`req._body`),
 * so JSON deliveries keep the platform behaviour untouched.
 */
export function rawTextBody(req: Request, _res: Response, next: NextFunction): void {
  const consumed = (req as Request & { _body?: boolean })._body;
  if (consumed || req.method === 'GET' || req.method === 'HEAD') return next();
  if (!TEXT_CONTENT_TYPE.test(String(req.headers['content-type'] ?? ''))) return next();

  const chunks: Buffer[] = [];
  let size = 0;
  let aborted = false;

  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_TEXT_BYTES) {
      aborted = true;
      next(new PayloadTooLargeException('Payload exceeds 512 KB'));
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    const raw = Buffer.concat(chunks);
    (req as Request & { rawBody?: Buffer; _body?: boolean }).rawBody = raw;
    req.body = raw.toString('utf-8');
    (req as Request & { _body?: boolean })._body = true;
    next();
  });
  req.on('error', (err) => {
    if (aborted) return;
    aborted = true;
    next(err);
  });
}
