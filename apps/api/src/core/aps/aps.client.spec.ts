import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApsClient } from './aps.client';
import type { ApsBridgeRequest } from './aps.types';

describe('ApsClient private bridge', () => {
  let client: ApsClient;
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = jest.fn();
    client = new ApsClient(new ConfigService({ APS_PORT: '8099', APS_API_KEY: 'test-key' }));
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });
  it('sends server-owned tenant context and service auth only to the private route', async () => {
    (fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    await client.runForTenant('tenant-a', { snapshot: {} } as ApsBridgeRequest);
    const [url, options] = (fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8099/internal/pulsar/run');
    expect(options.headers).toMatchObject({
      'X-Pulsar-Tenant': 'tenant-a',
      'X-API-Key': 'test-key',
    });
  });
  it('keeps the timeout active until the JSON response body finishes', async () => {
    jest.useFakeTimers();
    (fetch as jest.Mock).mockImplementation(async (_url, options) => ({
      ok: true,
      json: () =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('body timeout')));
        }),
    }));
    const pending = expect(client.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await jest.advanceTimersByTimeAsync(3001);
    await pending;
  });
  it('maps malformed JSON and network failure to a contained 503', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(new Response('not json'));
    await expect(client.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await expect(client.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('retains the engine publication refusal as a business error', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Frozen operations changed' }), { status: 422 }),
    );
    await expect(client.checkPublication('tenant-a', {}, null)).rejects.toEqual(
      new BadRequestException('Frozen operations changed'),
    );
  });
});
