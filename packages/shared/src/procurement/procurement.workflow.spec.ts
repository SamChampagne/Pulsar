import { describe, it, expect } from 'vitest';
import { canTransitionRfp, canTransitionBid, RfpStatus, BidStatus } from './procurement.workflow';

describe('canTransitionRfp', () => {
  // Valid transitions
  it('allows DRAFT → OPEN', () => expect(canTransitionRfp(RfpStatus.DRAFT, RfpStatus.OPEN)).toBe(true));
  it('allows DRAFT → CANCELLED', () => expect(canTransitionRfp(RfpStatus.DRAFT, RfpStatus.CANCELLED)).toBe(true));
  it('allows OPEN → EVALUATION', () => expect(canTransitionRfp(RfpStatus.OPEN, RfpStatus.EVALUATION)).toBe(true));
  it('allows OPEN → CANCELLED', () => expect(canTransitionRfp(RfpStatus.OPEN, RfpStatus.CANCELLED)).toBe(true));
  it('allows EVALUATION → AWARDED', () => expect(canTransitionRfp(RfpStatus.EVALUATION, RfpStatus.AWARDED)).toBe(true));
  it('allows EVALUATION → OPEN', () => expect(canTransitionRfp(RfpStatus.EVALUATION, RfpStatus.OPEN)).toBe(true));
  it('allows EVALUATION → CANCELLED', () => expect(canTransitionRfp(RfpStatus.EVALUATION, RfpStatus.CANCELLED)).toBe(true));

  // Invalid transitions
  it('blocks DRAFT → EVALUATION', () => expect(canTransitionRfp(RfpStatus.DRAFT, RfpStatus.EVALUATION)).toBe(false));
  it('blocks DRAFT → AWARDED', () => expect(canTransitionRfp(RfpStatus.DRAFT, RfpStatus.AWARDED)).toBe(false));
  it('blocks OPEN → AWARDED', () => expect(canTransitionRfp(RfpStatus.OPEN, RfpStatus.AWARDED)).toBe(false));
  it('blocks OPEN → DRAFT', () => expect(canTransitionRfp(RfpStatus.OPEN, RfpStatus.DRAFT)).toBe(false));

  // Terminal states — AWARDED and CANCELLED accept nothing
  it('blocks AWARDED → OPEN', () => expect(canTransitionRfp(RfpStatus.AWARDED, RfpStatus.OPEN)).toBe(false));
  it('blocks AWARDED → CANCELLED', () => expect(canTransitionRfp(RfpStatus.AWARDED, RfpStatus.CANCELLED)).toBe(false));
  it('blocks CANCELLED → OPEN', () => expect(canTransitionRfp(RfpStatus.CANCELLED, RfpStatus.OPEN)).toBe(false));
  it('blocks CANCELLED → DRAFT', () => expect(canTransitionRfp(RfpStatus.CANCELLED, RfpStatus.DRAFT)).toBe(false));

  // Self-transitions always allowed
  it('allows DRAFT → DRAFT (self)', () => expect(canTransitionRfp(RfpStatus.DRAFT, RfpStatus.DRAFT)).toBe(true));
  it('allows AWARDED → AWARDED (self)', () => expect(canTransitionRfp(RfpStatus.AWARDED, RfpStatus.AWARDED)).toBe(true));
  it('allows CANCELLED → CANCELLED (self)', () => expect(canTransitionRfp(RfpStatus.CANCELLED, RfpStatus.CANCELLED)).toBe(true));
});

describe('canTransitionBid', () => {
  // Valid transitions
  it('allows SUBMITTED → SHORTLISTED', () => expect(canTransitionBid(BidStatus.SUBMITTED, BidStatus.SHORTLISTED)).toBe(true));
  it('allows SUBMITTED → ACCEPTED', () => expect(canTransitionBid(BidStatus.SUBMITTED, BidStatus.ACCEPTED)).toBe(true));
  it('allows SUBMITTED → REJECTED', () => expect(canTransitionBid(BidStatus.SUBMITTED, BidStatus.REJECTED)).toBe(true));
  it('allows SHORTLISTED → ACCEPTED', () => expect(canTransitionBid(BidStatus.SHORTLISTED, BidStatus.ACCEPTED)).toBe(true));
  it('allows SHORTLISTED → REJECTED', () => expect(canTransitionBid(BidStatus.SHORTLISTED, BidStatus.REJECTED)).toBe(true));

  // Invalid transitions
  it('blocks SHORTLISTED → SUBMITTED', () => expect(canTransitionBid(BidStatus.SHORTLISTED, BidStatus.SUBMITTED)).toBe(false));

  // Terminal states — ACCEPTED and REJECTED accept nothing else
  it('blocks ACCEPTED → SHORTLISTED', () => expect(canTransitionBid(BidStatus.ACCEPTED, BidStatus.SHORTLISTED)).toBe(false));
  it('blocks ACCEPTED → REJECTED', () => expect(canTransitionBid(BidStatus.ACCEPTED, BidStatus.REJECTED)).toBe(false));
  it('blocks REJECTED → ACCEPTED', () => expect(canTransitionBid(BidStatus.REJECTED, BidStatus.ACCEPTED)).toBe(false));
  it('blocks REJECTED → SHORTLISTED', () => expect(canTransitionBid(BidStatus.REJECTED, BidStatus.SHORTLISTED)).toBe(false));

  // Self-transitions always allowed
  it('allows SUBMITTED → SUBMITTED (self)', () => expect(canTransitionBid(BidStatus.SUBMITTED, BidStatus.SUBMITTED)).toBe(true));
  it('allows ACCEPTED → ACCEPTED (self)', () => expect(canTransitionBid(BidStatus.ACCEPTED, BidStatus.ACCEPTED)).toBe(true));
  it('allows REJECTED → REJECTED (self)', () => expect(canTransitionBid(BidStatus.REJECTED, BidStatus.REJECTED)).toBe(true));
});
