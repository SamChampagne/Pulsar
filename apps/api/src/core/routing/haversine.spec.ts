import { haversineKm, pathDistanceKm } from './haversine';

const MTL = { lat: 45.5019, lng: -73.5674 };
const QC = { lat: 46.8131, lng: -71.2075 };

describe('haversine', () => {
  it('returns 0 for the same point', () => {
    expect(haversineKm(MTL, MTL)).toBe(0);
  });

  it('Montréal → Québec is ~233 km as the crow flies', () => {
    const d = haversineKm(MTL, QC);
    expect(d).toBeGreaterThan(225);
    expect(d).toBeLessThan(242);
  });

  it('pathDistanceKm sums consecutive legs and rounds to 0.1', () => {
    const d = pathDistanceKm([MTL, QC, MTL]);
    expect(d).toBeCloseTo(2 * haversineKm(MTL, QC), 0);
    expect(d).toBe(Math.round(d * 10) / 10);
  });

  it('pathDistanceKm of fewer than 2 points is 0', () => {
    expect(pathDistanceKm([])).toBe(0);
    expect(pathDistanceKm([MTL])).toBe(0);
  });

  it('antipodal points are ~half the Earth circumference', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(20015, 0);
  });

  it('handles southern-hemisphere (negative latitude) coordinates', () => {
    const sydney = { lat: -33.8688, lng: 151.2093 };
    const melbourne = { lat: -37.8136, lng: 144.9631 };
    const d = haversineKm(sydney, melbourne);
    expect(d).toBeGreaterThan(680);
    expect(d).toBeLessThan(730);
  });
});
