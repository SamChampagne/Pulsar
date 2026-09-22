import { describe, expect, it } from 'vitest';
import { MODULE_LESSONS, LESSON_TITLES } from './module-lessons';
import { shouldStartTour } from './tours';
describe('parcours métier versionnés', () => {
  it('publie des séquences adaptées plutôt qu’un gabarit fixe', () => {
    expect(MODULE_LESSONS.hr).toHaveLength(7);
    expect(MODULE_LESSONS.quality).toHaveLength(6);
    expect(MODULE_LESSONS.support).toHaveLength(5);
    expect(MODULE_LESSONS.purchasing).toHaveLength(6);
    const titles = Object.values(MODULE_LESSONS).flatMap((x) => x.map((s) => s.title));
    expect(new Set(titles).size).toBe(titles.length);
    for (const steps of Object.values(MODULE_LESSONS))
      for (const s of steps) expect(s.text.length).toBeGreaterThan(80);
    expect(LESSON_TITLES.services[2]).toContain('temps');
  });
  it('présente seulement les modules encore jamais ouverts, quelle que soit la version', () => {
    expect(shouldStartTour()).toBe(true);
    for (const version of [1, 2]) {
      for (const status of ['COMPLETED', 'SKIPPED', 'IN_PROGRESS'] as const) {
        expect(shouldStartTour({ version, step: 0, status })).toBe(false);
      }
    }
  });
});
