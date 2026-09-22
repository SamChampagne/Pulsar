import { describe, expect, it } from 'vitest';
import { pickerScanContext } from './context';
import { shouldStartTour } from '../help/tours';

describe('scanner picker scopes', () => {
  it('supports item choices and site-scoped bins', () => {
    expect(pickerScanContext('/wms/choices/items', {})).toEqual({ kind: 'item' });
    expect(pickerScanContext('/wms/sites/site-a/bins', {})).toEqual({
      kind: 'bin',
      locationId: 'site-a',
    });
    expect(pickerScanContext('/transportation/customers', {})).toBeNull();
  });
});
describe('first entry tours', () => {
  it('starts unseen tours without automatically reopening unfinished tours', () => {
    expect(shouldStartTour()).toBe(true);
    expect(shouldStartTour({ version: 1, step: 2, status: 'IN_PROGRESS' })).toBe(false);
  });
  it.each(['COMPLETED', 'SKIPPED'] as const)('does not repeat %s tours', (status) => {
    expect(shouldStartTour({ version: 1, step: 4, status })).toBe(false);
  });
});
