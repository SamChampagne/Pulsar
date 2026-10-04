import { OsrmClient } from './osrm.client';

const MTL = { lat: 45.5019, lng: -73.5674 };
const QC = { lat: 46.8131, lng: -71.2075 };

describe('OsrmClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    // Restore by direct assignment — jest.restoreAllMocks() is a no-op here because
    // we replace global.fetch directly rather than via jest.spyOn.
    global.fetch = realFetch;
  });

  it('parses distance (m→km), duration (s→min) and geometry; coords are lng,lat ordered', async () => {
    const geometry = {
      type: 'LineString',
      coordinates: [
        [-73.57, 45.5],
        [-71.21, 46.81],
      ],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 271_400, duration: 10_980, geometry }],
      }),
    }) as unknown as typeof fetch;

    const client = new OsrmClient('http://osrm.local');
    const result = await client.route([MTL, QC]);

    expect(result).toEqual({ distanceKm: 271.4, durationMin: 183, geometry });
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    // OSRM expects {lng},{lat};{lng},{lat} + simplified geojson overview (spec §A)
    expect(url).toBe(
      'http://osrm.local/route/v1/driving/-73.5674,45.5019;-71.2075,46.8131?overview=simplified&geometries=geojson',
    );
  });

  it('returns null on HTTP error', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    expect(await new OsrmClient('http://osrm.local').route([MTL, QC])).toBeNull();
  });

  it('returns null on OSRM error code', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'NoRoute', routes: [] }),
    }) as unknown as typeof fetch;
    expect(await new OsrmClient('http://osrm.local').route([MTL, QC])).toBeNull();
  });

  it('returns null on network failure/timeout', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('aborted')) as unknown as typeof fetch;
    expect(await new OsrmClient('http://osrm.local').route([MTL, QC])).toBeNull();
  });

  it('returns null when OSRM replies Ok with no routes', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'Ok', routes: [] }),
    }) as unknown as typeof fetch;
    expect(await new OsrmClient('http://osrm.local').route([MTL, QC])).toBeNull();
  });

  it('returns null without fetching when fewer than 2 points', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(await new OsrmClient('http://osrm.local').route([MTL])).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('normalizes a trailing slash on the host', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 1000, duration: 60, geometry: null }],
      }),
    }) as unknown as typeof fetch;
    await new OsrmClient('http://osrm.local/').route([MTL, QC]);
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url.startsWith('http://osrm.local/route/v1/')).toBe(true);
  });

  it('preserves directional route legs in km and minutes', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            distance: 2500,
            duration: 180,
            geometry: null,
            legs: [
              { distance: 1000, duration: 60 },
              { distance: 1500, duration: 120 },
            ],
          },
        ],
      }),
    }) as unknown as typeof fetch;
    expect((await new OsrmClient('http://osrm.local').route([MTL, QC, MTL]))?.legs).toEqual([
      { distanceKm: 1, durationMin: 1 },
      { distanceKm: 1.5, durationMin: 2 },
    ]);
  });
  it('rejects malformed metrics and incomplete leg arrays', async () => {
    for (const route of [
      { distance: -1, duration: 1 },
      { distance: 1, duration: NaN },
      { distance: 1, duration: 1, legs: [] },
    ]) {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 'Ok', routes: [route] }),
      }) as unknown as typeof fetch;
      expect(await new OsrmClient('http://osrm.local').route([MTL, QC])).toBeNull();
    }
  });
  it('converts a directed matrix and retains unreachable pairs', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 'Ok',
        distances: [
          [0, 1000],
          [null, 0],
        ],
        durations: [
          [0, 90],
          [null, 0],
        ],
      }),
    }) as unknown as typeof fetch;
    expect(await new OsrmClient('http://osrm.local').table([MTL, QC])).toEqual({
      distancesKm: [
        [0, 1],
        [null, 0],
      ],
      durationsMin: [
        [0, 1.5],
        [null, 0],
      ],
    });
  });
  it('bounds optimization and rejects malformed matrices or coordinates without retries', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'Ok', distances: [[0]], durations: [[0]] }),
    }) as unknown as typeof fetch;
    const client = new OsrmClient('http://osrm.local');
    expect(await client.table(Array(51).fill(MTL))).toBeNull();
    expect(await client.route([MTL, { lat: NaN, lng: 2 }])).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await client.table([MTL, QC])).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
