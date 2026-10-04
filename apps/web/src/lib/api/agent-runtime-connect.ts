import { getAccessToken } from '$lib/stores/auth';

export type RuntimeConnectPhase = 'STARTING' | 'WAITING_AUTHORIZATION' | 'VERIFYING';
export type RuntimeConnectEvent =
  | { type: 'status'; phase: RuntimeConnectPhase; message: string }
  | { type: 'text'; text: string }
  | { type: 'error'; message: string }
  | { type: 'end' };
export type RuntimeConnectOptions = {
  path?: string;
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
};
const MAX_BUFFER = 65_536;
const phases: RuntimeConnectPhase[] = ['STARTING', 'WAITING_AUTHORIZATION', 'VERIFYING'];

/** Await bounded I/O even when a proxy or test transport never resolves its promise. */
function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Connection cancelled', 'AbortError'));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** One login attempt only: no retry, bounded silence/output, terminal success required. */
export async function* streamRuntimeConnect(
  options: RuntimeConnectOptions = {},
): AsyncGenerator<RuntimeConnectEvent> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let failure = '';
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let terminal = false;
  let received = 0;
  const timeout = (message: string) => {
    failure = message;
    controller.abort();
  };
  let idle = setTimeout(
    () =>
      timeout(
        'Le serveur ne répond pas à la demande de connexion. Vérifiez le runner et le proxy du VPS.',
      ),
    15_000,
  );
  const deadline = setTimeout(
    () =>
      timeout(
        'La tentative a expiré après 10 minutes. Vérifiez son état avant de lancer une nouvelle connexion.',
      ),
    600_000,
  );
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () =>
        timeout(
          'Le flux de connexion est silencieux depuis 45 secondes. Vérifiez le runner et la transmission SSE du proxy; aucun renvoi automatique.',
        ),
      45_000,
    );
  };
  if (options.signal?.aborted) cancel();
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await abortable(
      fetch(`/api/v1${options.path ?? '/agent-runtime/connect'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...((options.token === undefined ? getAccessToken() : options.token)
            ? {
                Authorization: `Bearer ${options.token === undefined ? getAccessToken() : options.token}`,
              }
            : {}),
        },
        body: JSON.stringify(options.body ?? {}),
        signal: controller.signal,
      }),
      controller.signal,
    );
    touch();
    if (!response.ok) {
      let message =
        response.status === 401
          ? 'Votre session a expiré. Reconnectez-vous à Pulsar.'
          : `Connexion refusée (${response.status}). Consultez le diagnostic du runner.`;
      try {
        const data = await abortable(response.json(), controller.signal);
        if (typeof data?.message === 'string') message = data.message.slice(0, 2000);
      } catch {
        /* Keep safe HTTP detail; no raw transport/HTML response. */
      }
      yield { type: 'error', message };
      return;
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      yield {
        type: 'error',
        message:
          'Réponse inattendue : le flux de connexion est absent. Vérifiez le proxy et la version du serveur.',
      };
      return;
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!terminal) {
      const { done, value } = await abortable(reader.read(), controller.signal);
      if (done) break;
      touch();
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_BUFFER) throw new Error('OUTPUT_LIMIT');
      let delimiter: RegExpMatchArray | null;
      while ((delimiter = buffer.match(/\r?\n\r?\n/))) {
        const index = delimiter.index!;
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + delimiter[0].length);
        const event = parseConnectFrame(frame);
        if (!event) continue; // Heartbeats keep the connection alive, not a false success.
        received += frame.length;
        if (received > MAX_BUFFER) throw new Error('OUTPUT_LIMIT');
        if (event.type === 'end' || event.type === 'error') terminal = true;
        yield event;
        if (terminal) break;
      }
    }
    if (!terminal) {
      const tail = parseConnectFrame(buffer + decoder.decode());
      if (tail) {
        terminal = tail.type === 'end' || tail.type === 'error';
        yield tail;
      }
      if (!terminal)
        yield {
          type: 'error',
          message:
            'Connexion interrompue sans confirmation. Vérifiez le statut enregistré avant de réessayer.',
        };
    }
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('Connection cancelled', 'AbortError');
    yield {
      type: 'error',
      message:
        failure ||
        (error instanceof Error && error.message === 'OUTPUT_LIMIT'
          ? 'Sortie du moteur trop volumineuse. Tentative arrêtée; consultez le diagnostic serveur.'
          : 'Connexion interrompue. Vérifiez votre réseau et le runner; aucune relance automatique.'),
    };
  } finally {
    clearTimeout(idle);
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', cancel);
    controller.abort();
    // Do not wait indefinitely on a stalled transport cancellation.
    void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

function parseConnectFrame(frame: string): RuntimeConnectEvent | null {
  let event = '';
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!event || !['text', 'status', 'error', 'end'].includes(event)) return null;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(dataLines.join('\n'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Invalid frame');
    data = parsed as Record<string, unknown>;
  } catch {
    return {
      type: 'error',
      message: 'Réponse de connexion invalide. Vérifiez la compatibilité API/runner.',
    };
  }
  if (event === 'end') return { type: 'end' };
  if (event === 'error')
    return {
      type: 'error',
      message:
        typeof data.message === 'string'
          ? data.message.slice(0, 2000)
          : 'Connexion refusée par le runner.',
    };
  if (event === 'text' && typeof data.text === 'string')
    return { type: 'text', text: data.text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '') };
  if (event === 'status' && phases.includes(data.phase as RuntimeConnectPhase))
    return {
      type: 'status',
      phase: data.phase as RuntimeConnectPhase,
      message: typeof data.message === 'string' ? data.message.slice(0, 1000) : '',
    };
  return { type: 'error', message: 'État de connexion invalide. Actualisez le diagnostic.' };
}
