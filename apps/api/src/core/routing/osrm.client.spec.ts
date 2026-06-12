import { OsrmClient } from './osrm.client';

const MTL = { lat: 45.5019, lng: -73.5674 };
const QC = { lat: 46.8131, lng: -71.2075 };

describe('OsrmClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('parses distance (m→km), duration (s→min) and geometry; coords are lng,lat ordered', async () => {
    const geometry = { type: 'LineString', coordinates: [[-73.57, 45.5], [-71.21, 46.81]] };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'Ok', routes: [{ distance: 271_400, duration: 10_980, geometry }] }),
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
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
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
});
