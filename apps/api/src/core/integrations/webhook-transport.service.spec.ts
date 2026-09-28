import { ConfigService } from '@nestjs/config';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupAddress } from 'node:dns';
import {
  isPublicWebhookAddress,
  pinnedWebhookLookup,
  resolveWebhookAddress,
  WebhookTransportService,
} from './webhook-transport.service';

// Jest otherwise selects the last (single-address) overload of dns.lookup.
const dns = jest.requireActual<typeof import('node:dns/promises')>('node:dns/promises');
const spyOnLookupAll = () =>
  jest.spyOn(dns, 'lookup') as unknown as jest.SpyInstance<
    Promise<LookupAddress[]>,
    [string, { all: true; verbatim: true }]
  >;

describe('webhook destination policy', () => {
  it.each([
    '127.0.0.1',
    '10.3.4.5',
    '172.17.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.1.1',
    '0.0.0.0',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:db8::1',
    '2001::1',
    '3fff::1',
    'not-an-ip',
  ])('rejects non-public/transition address %s', (address) => {
    expect(isPublicWebhookAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111'])(
    'permits public address %s',
    (address) => expect(isPublicWebhookAddress(address)).toBe(true),
  );

  it.each([
    'http://localhost/h',
    'http://2130706433/h',
    'file:///etc/passwd',
    'https://user:secret@example.com',
    'https://example.com/h#fragment',
  ])('rejects forbidden URL %s before resolving', async (url) => {
    const dns = jest.fn();
    await expect(resolveWebhookAddress(new URL(url), false, dns)).rejects.toMatchObject({
      code: 'DESTINATION',
    });
    expect(dns).not.toHaveBeenCalled();
  });

  it('rejects a public hostname if ANY DNS answer is private (A or AAAA)', async () => {
    for (const address of ['10.0.0.2', '::1']) {
      const dns = jest.fn().mockResolvedValue([
        { address: '8.8.8.8', family: 4 },
        { address, family: address.includes(':') ? 6 : 4 },
      ]);
      await expect(
        resolveWebhookAddress(new URL('https://hook.example.com'), false, dns),
      ).rejects.toMatchObject({ code: 'DESTINATION' });
    }
  });

  it('fails closed on empty, invalid or inconsistent DNS results', async () => {
    for (const answers of [
      [],
      [{ address: 'name.example', family: 4 }],
      [{ address: '8.8.8.8', family: 6 }],
    ]) {
      await expect(
        resolveWebhookAddress(new URL('https://hook.example.com'), false, async () => answers),
      ).rejects.toMatchObject({ code: 'DESTINATION' });
    }
  });

  it('does not expose the resolver error content', async () => {
    await expect(
      resolveWebhookAddress(new URL('https://hook.example.com/secret'), false, async () => {
        throw new Error('secret DNS internal contents');
      }),
    ).rejects.toThrow('Résolution DNS du webhook impossible.');
  });

  it('pins the approved result without performing a second DNS lookup', async () => {
    const dns = jest
      .fn()
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const address = await resolveWebhookAddress(new URL('https://hook.example.com'), false, dns);
    const callback = jest.fn();
    const pinned = pinnedWebhookLookup(address);
    pinned('hook.example.com', {}, callback);
    expect(callback).toHaveBeenLastCalledWith(null, '8.8.8.8', 4);
    pinned('hook.example.com', { all: true } as any, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
    expect(dns).toHaveBeenCalledTimes(1);
    // The next attempt resolves afresh, and refuses the new internal destination.
    await expect(
      resolveWebhookAddress(new URL('https://hook.example.com'), false, dns),
    ).rejects.toMatchObject({ code: 'DESTINATION' });
  });
});

describe('webhook transport over an actual local socket (explicit test escape hatch)', () => {
  let server: Server;
  let url: string;
  const config = new ConfigService({ NODE_ENV: 'test', WEBHOOK_ALLOW_PRIVATE_URLS: 'true' });
  const service = new WebhookTransportService(config);

  beforeEach(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POSTs exactly the signed body/headers and ignores the response body', async () => {
    let received = '';
    server.on('request', (req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toBe('/hook?token=test');
      expect(req.headers['x-pulsar-signature']).toBe('sha256=test');
      req.on('data', (data) => {
        received += data;
      });
      req.on('end', () => {
        res.writeHead(204);
        res.end();
      });
    });
    await expect(
      service.post(
        `${url}/hook?token=test`,
        { 'X-Pulsar-Signature': 'sha256=test' },
        '{"event":"ping"}',
      ),
    ).resolves.toEqual({ ok: true, status: 204 });
    expect(received).toBe('{"event":"ping"}');
  });

  it('uses the checked DNS address for the actual socket and preserves the original Host', async () => {
    const resolve = spyOnLookupAll()
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.2', family: 4 }]);
    const host = `receiver.example.test:${(server.address() as AddressInfo).port}`;
    let receivedHost: string | undefined;
    server.on('request', (req, res) => {
      receivedHost = req.headers.host;
      res.writeHead(204);
      res.end();
    });
    await expect(service.post(`http://${host}/hook`, {}, '{}')).resolves.toEqual({
      ok: true,
      status: 204,
    });
    expect(receivedHost).toBe(host);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('refuses a DNS destination before opening a socket when the escape hatch is absent', async () => {
    const resolve = spyOnLookupAll().mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    const guarded = new WebhookTransportService(new ConfigService({ NODE_ENV: 'test' }));
    const received = jest.fn();
    server.on('request', received);
    await expect(
      guarded.post(
        `http://receiver.example.test:${(server.address() as AddressInfo).port}`,
        {},
        '{}',
      ),
    ).rejects.toMatchObject({ code: 'DESTINATION' });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(received).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])(
    'does not follow redirect %s or forward signed data',
    async (status) => {
      const requests: string[] = [];
      server.on('request', (req, res) => {
        requests.push(req.url!);
        res.writeHead(status, { Location: `${url}/secret` });
        res.end();
      });
      await expect(service.post(`${url}/hook`, {}, 'sensitive business payload')).resolves.toEqual({
        ok: false,
        status,
      });
      expect(requests).toEqual(['/hook']);
    },
  );

  it('does not allow the dev escape hatch in production', async () => {
    const production = new WebhookTransportService(
      new ConfigService({
        NODE_ENV: 'production',
        WEBHOOK_ALLOW_PRIVATE_URLS: 'true',
      }),
    );
    await expect(production.post(url, {}, '{}')).rejects.toMatchObject({ code: 'DESTINATION' });
  });

  it('returns a bounded, sanitized timeout and closes the socket', async () => {
    server.on('request', () => {
      /* never responds */
    });
    await expect(service.post(`${url}/secret-token`, {}, '{}')).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  }, 8000);
});
