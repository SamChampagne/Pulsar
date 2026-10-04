import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { LOGIN_TIMEOUT_MS, type LoginEvent } from './login-stream';

/** Same bounded login transport for tenant administrators and platform operators.
 * Authorization must finish before invoking this function. Never log the code/URL.
 */
export async function streamLoginSse(
  res: Response,
  connect: (signal: AbortSignal) => AsyncGenerator<LoginEvent>,
): Promise<void> {
  // Platform authorization may have awaited I/O after the client disconnected.
  // A past close event cannot be observed by a newly attached listener.
  if (res.destroyed || res.writableEnded) return;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (event: string, data: unknown) => {
    if (!res.destroyed && !res.writableEnded)
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const abort = new AbortController();
  const onClose = () => abort.abort();
  res.on('close', onClose);
  if (res.destroyed || res.writableEnded) {
    res.removeListener('close', onClose);
    abort.abort();
    return;
  }
  let terminal = false;
  const heartbeat = setInterval(() => {
    if (!terminal && !res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);
  const deadline = setTimeout(() => {
    if (!terminal)
      send('error', {
        code: 'LOGIN_TIMEOUT',
        message:
          'La connexion a expiré après 9 minutes. Vérifiez les instructions du fournisseur avant de la relancer.',
      });
    terminal = true;
    abort.abort();
    if (!res.writableEnded) res.end();
  }, LOGIN_TIMEOUT_MS);
  try {
    for await (const event of connect(abort.signal)) {
      if (terminal || abort.signal.aborted) break;
      if (event.type === 'text') send('text', { text: event.text });
      else if (event.type === 'status')
        send('status', { phase: event.phase, message: event.message });
      else if (event.type === 'error') {
        terminal = true;
        send('error', { code: event.code, message: event.message });
        break;
      } else if (event.type === 'end') {
        terminal = true;
        send('end', {});
        break;
      }
    }
    if (!terminal && !abort.signal.aborted)
      send('error', {
        code: 'LOGIN_INTERRUPTED',
        message:
          'Connexion interrompue avant confirmation. Actualisez son état avant de la relancer.',
      });
  } catch (error) {
    if (!terminal && !abort.signal.aborted) {
      const message =
        error instanceof BadRequestException || error instanceof ServiceUnavailableException
          ? error.message.slice(0, 512)
          : 'Connexion indisponible. Vérifiez le diagnostic du runner et la configuration du fournisseur.';
      send('error', { code: 'LOGIN_FAILED', message });
    }
  } finally {
    clearInterval(heartbeat);
    clearTimeout(deadline);
    res.removeListener('close', onClose);
    abort.abort();
    if (!res.writableEnded) res.end();
  }
}
