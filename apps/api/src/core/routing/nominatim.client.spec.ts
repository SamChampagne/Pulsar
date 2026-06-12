import { NominatimClient } from './nominatim.client';

describe('NominatimClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    // Cleanup is the direct assignment — tests set global.fetch directly.
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('parses the first result and sends the custom User-Agent', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '45.5019', lon: '-73.5674' }],
    }) as unknown as typeof fetch;

    const client = new NominatimClient('https://nominatim.test');
    const result = await client.geocode('1 Main St, Montréal, QC, CA');

    expect(result).toEqual({ lat: 45.5019, lng: -73.5674 });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://nominatim.test/search?format=jsonv2&limit=1&q=');
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('Pulsar');
  });

  it('returns null on empty results, HTTP error and network failure', async () => {
    const client = new NominatimClient('https://nominatim.test');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
    expect(await client.geocode('nowhere')).toBeNull();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch;
    expect(await client.geocode('nowhere')).toBeNull();
    global.fetch = jest.fn().mockRejectedValue(new Error('aborted')) as unknown as typeof fetch;
    expect(await client.geocode('nowhere')).toBeNull();
  });

  it('spaces consecutive calls by at least ~1s (in-process throttle)', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '1', lon: '2' }],
    }) as unknown as typeof fetch;

    const client = new NominatimClient('https://nominatim.test');
    const first = client.geocode('a');
    const second = client.geocode('b');

    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1); // second call queued
    await jest.advanceTimersByTimeAsync(1200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await expect(first).resolves.toEqual({ lat: 1, lng: 2 });
    await expect(second).resolves.toEqual({ lat: 1, lng: 2 });
  });
});
