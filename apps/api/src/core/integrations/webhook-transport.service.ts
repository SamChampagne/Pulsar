import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { checkWebhookUrl } from '@pulsar/shared';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const TIMEOUT_MS = 5000;

// Fail closed for special-use space; this is an outbound business webhook, not
// an arbitrary network client. IPv6 transition mechanisms are not supported.
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(network, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicWebhookAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) {
    return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
  }
  return false;
}

/** Stable messages only: socket/DNS errors can contain a URL, IP or credentials. */
export class WebhookTransportError extends Error {
  constructor(public readonly code: 'DESTINATION' | 'DNS' | 'TIMEOUT' | 'NETWORK') {
    super(
      {
        DESTINATION: 'Destination webhook interdite ou invalide.',
        DNS: 'Résolution DNS du webhook impossible.',
        TIMEOUT: 'Délai du webhook dépassé (5 secondes).',
        NETWORK: 'Connexion au webhook impossible.',
      }[code],
    );
  }
}

type Resolver = (hostname: string) => Promise<LookupAddress[]>;

/** Check ALL answers, then connect to ONE checked address without another DNS lookup. */
export async function resolveWebhookAddress(
  url: URL,
  allowPrivate: boolean,
  resolve: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true }),
): Promise<LookupAddress> {
  const check = checkWebhookUrl(url.href, { allowPrivate });
  if (!check.ok || url.username || url.password || url.hash) {
    throw new WebhookTransportError('DESTINATION');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  let answers: LookupAddress[];
  try {
    answers = family ? [{ address: hostname, family }] : await resolve(hostname);
  } catch {
    throw new WebhookTransportError('DNS');
  }
  if (
    !answers.length ||
    answers.some(
      (answer) =>
        isIP(answer.address) !== answer.family ||
        ![4, 6].includes(answer.family) ||
        (!allowPrivate && !isPublicWebhookAddress(answer.address)),
    )
  )
    throw new WebhookTransportError('DESTINATION');
  return answers[0];
}

/** Preserve Host + HTTPS SNI/certificate checks while pinning the actual socket destination. */
export function pinnedWebhookLookup(address: LookupAddress): NonNullable<RequestOptions['lookup']> {
  return (_hostname, options, callback) => {
    // Node's autoSelectFamily asks for all answers; never resolve again here.
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (err: null, addresses: LookupAddress[]) => void)(null, [address]);
    } else {
      callback(null, address.address, address.family);
    }
  };
}

@Injectable()
export class WebhookTransportService {
  constructor(private readonly config: ConfigService) {}

  async post(url: string, headers: Record<string, string>, body: string) {
    // Boot checks also forbid this flag in production; keep enforcement local.
    const allowPrivate =
      this.config.get('NODE_ENV') !== 'production' &&
      this.config.get('WEBHOOK_ALLOW_PRIVATE_URLS') === 'true';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let onAbort: (() => void) | undefined;
    try {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new WebhookTransportError('DESTINATION');
      }
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new WebhookTransportError('TIMEOUT'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const address = await Promise.race([resolveWebhookAddress(parsed, allowPrivate), aborted]);
      controller.signal.throwIfAborted();
      return await new Promise<{ ok: boolean; status: number }>((resolve, reject) => {
        const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
        const req = request(
          parsed,
          {
            method: 'POST',
            headers,
            agent: false,
            lookup: pinnedWebhookLookup(address),
            signal: controller.signal,
          },
          (res) => {
            // Node's low-level client does not follow redirects. Never read/store a
            // response body (including an unbounded body or a secret-bearing error).
            const status = res.statusCode ?? 0;
            res.destroy();
            resolve({ ok: status >= 200 && status < 300, status });
          },
        );
        req.on('error', () =>
          reject(new WebhookTransportError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK')),
        );
        req.end(body);
      });
    } catch (err) {
      if (err instanceof WebhookTransportError) throw err;
      throw new WebhookTransportError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
    } finally {
      clearTimeout(timeout);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    }
  }
}
