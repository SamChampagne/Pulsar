import { describe, it, expect } from 'vitest';
import { canTransitionServiceAcceptance, serviceAcceptanceBlock } from './service-acceptance';

describe('work acceptance', () => {
  it('records reservations until final acceptance, never rewrites accepted history', () => {
    for (const from of ['PENDING', 'RESERVATIONS']) {
      expect(canTransitionServiceAcceptance(from, 'RESERVATIONS')).toBe(true);
      expect(canTransitionServiceAcceptance(from, 'ACCEPTED')).toBe(true);
    }
    for (const to of ['PENDING', 'RESERVATIONS', 'ACCEPTED'])
      expect(canTransitionServiceAcceptance('ACCEPTED', to)).toBe(false);
    expect(canTransitionServiceAcceptance('UNKNOWN', 'ACCEPTED')).toBe(false);
  });
  it('preserves optional projects and gates completed work only when explicitly required', () => {
    expect(
      serviceAcceptanceBlock(false, { status: 'IN_PROGRESS', acceptanceStatus: 'PENDING' }),
    ).toBeNull();
    expect(
      serviceAcceptanceBlock(true, { status: 'IN_PROGRESS', acceptanceStatus: 'ACCEPTED' }),
    ).toBeTruthy();
    expect(
      serviceAcceptanceBlock(true, { status: 'COMPLETED', acceptanceStatus: 'RESERVATIONS' }),
    ).toBeTruthy();
    expect(
      serviceAcceptanceBlock(true, { status: 'COMPLETED', acceptanceStatus: 'ACCEPTED' }),
    ).toBeNull();
  });
});
