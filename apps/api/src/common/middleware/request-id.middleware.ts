import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Request augmented with the correlation id stamped by `requestIdMiddleware`. */
export type RequestWithId = Request & { requestId?: string };

/**
 * Correlation id for every request: reuse an incoming `x-request-id` header
 * (so an upstream proxy/gateway id survives), otherwise mint one. Always
 * echoed back on the response header so a caller can log/report it.
 * Dependency-free (`node:crypto`), applied globally via `app.use()` in main.ts.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  (req as RequestWithId).requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
