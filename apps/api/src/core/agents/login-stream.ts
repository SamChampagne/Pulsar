import type { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

export type LoginPhase = 'STARTING' | 'WAITING_AUTHORIZATION' | 'VERIFYING';
export interface LoginEvent {
  type: 'text' | 'status' | 'error' | 'end';
  text?: string;
  message?: string;
  phase?: LoginPhase;
  code?: string;
}
export const LOGIN_TIMEOUT_MS = 9 * 60_000;
const OUTPUT_LIMIT = 65_536;
type LoginProcess = EventEmitter & {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
};
const errors: Record<string, string> = {
  LOGIN_TIMEOUT:
    'La connexion a expiré après 9 minutes. Vérifiez les instructions du fournisseur avant de la relancer.',
  LOGIN_CANCELLED:
    'Connexion interrompue. Actualisez son état avant de la relancer si le fournisseur avait déjà confirmé l’autorisation.',
  LOGIN_OUTPUT_LIMIT:
    'La sortie de connexion dépasse la limite autorisée. Vérifiez le diagnostic du runner.',
  LOGIN_PROTOCOL:
    'Le runner a retourné un flux de connexion invalide. Vérifiez sa version et son diagnostic.',
  LOGIN_INTERRUPTED:
    'Le flux de connexion a été interrompu avant confirmation. Vérifiez le runner puis relancez la connexion.',
  LOGIN_EXIT:
    'Le fournisseur a refusé ou interrompu la connexion. Consultez les instructions affichées; aucun modèle n’a été testé.',
  LOGIN_PROCESS:
    'Le processus de connexion n’a pas pu démarrer. Vérifiez l’installation et le diagnostic du runtime.',
};

/** Bounded process stream. No automatic retry, token parsing or provider-specific OAuth implementation. */
export async function* streamLoginProcess(
  child: LoginProcess,
  mode: 'text' | 'ndjson',
  signal?: AbortSignal,
  timeoutMs = LOGIN_TIMEOUT_MS,
): AsyncGenerator<LoginEvent> {
  const queue: LoginEvent[] = [];
  let wake: (() => void) | undefined;
  let done = false,
    bytes = 0,
    buffer = '',
    waiting = false,
    killed = false,
    closed = false;
  const decoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  const push = (event: LoginEvent) => {
    queue.push(event);
    wake?.();
  };
  const stop = () => {
    if (killed || closed) return;
    killed = true;
    const force = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, 2000);
    force.unref();
    child.once('close', () => clearTimeout(force));
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(force);
    }
  };
  const finish = (code?: string) => {
    if (done) return;
    done = true;
    push(
      code ? { type: 'error', code, message: errors[code] ?? errors.LOGIN_EXIT } : { type: 'end' },
    );
    if (code) stop();
  };
  const text = (value: string) => {
    if (!value) return;
    if (!waiting) {
      waiting = true;
      push({
        type: 'status',
        phase: 'WAITING_AUTHORIZATION',
        message: 'Suivez les instructions du fournisseur dans votre navigateur.',
      });
    }
    // CLI colour/control sequences are not useful in the browser; device URL/code remain intact.
    push({
      type: 'text',
      text: value
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''),
    });
  };
  const consume = (chunk: Buffer | string, stderr = false) => {
    if (done) return;
    bytes += Buffer.byteLength(chunk);
    if (bytes > OUTPUT_LIMIT) return finish('LOGIN_OUTPUT_LIMIT');
    const value =
      typeof chunk === 'string' ? chunk : (stderr ? stderrDecoder : decoder).write(chunk);
    if (mode === 'text') return text(value);
    if (stderr) return; // Remote diagnostics are never public text.
    buffer += value;
    let nl: number;
    while (!done && (nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'text' && typeof event.text === 'string') text(event.text);
        else if (event.type === 'end') finish();
        else if (event.type === 'error')
          finish(typeof event.code === 'string' && errors[event.code] ? event.code : 'LOGIN_EXIT');
        else throw new Error('Unexpected login event');
      } catch {
        finish('LOGIN_PROTOCOL');
      }
    }
  };
  const stdout = (chunk: Buffer | string) => consume(chunk);
  const stderr = (chunk: Buffer | string) => consume(chunk, true);
  const processError = () => finish('LOGIN_PROCESS');
  const close = (code: number | null) => {
    closed = true;
    finish(mode === 'text' ? (code === 0 ? undefined : 'LOGIN_EXIT') : 'LOGIN_INTERRUPTED');
  };
  const end = () => {
    if (mode === 'ndjson') finish('LOGIN_INTERRUPTED');
  };
  const abort = () => finish('LOGIN_CANCELLED');
  const timer = setTimeout(() => finish('LOGIN_TIMEOUT'), timeoutMs);
  child.stdout?.on('data', stdout);
  child.stderr?.on('data', stderr);
  child.stdout?.on('end', end);
  child.stdout?.on('error', processError);
  child.stderr?.on('error', processError);
  child.on('error', processError);
  child.on('close', close);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    while (!done || queue.length) {
      while (queue.length) yield queue.shift()!;
      if (!done)
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      wake = undefined;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    child.stdout?.removeListener('data', stdout);
    child.stderr?.removeListener('data', stderr);
    child.stdout?.removeListener('end', end);
    child.stdout?.removeListener('error', processError);
    child.stderr?.removeListener('error', processError);
    child.removeListener('error', processError);
    child.removeListener('close', close);
    // A failed spawn/pipe can report an error after cancellation. Keep teardown
    // isolated from Nest even after the consumer has stopped observing it.
    child.on('error', () => {});
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    stop();
  }
}
