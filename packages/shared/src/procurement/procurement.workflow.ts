// Pure. Mirrored in packages/database schema.prisma (procurement module).

export enum RfpStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  EVALUATION = 'EVALUATION',
  AWARDED = 'AWARDED',
  CANCELLED = 'CANCELLED',
}

const RFP: Record<RfpStatus, RfpStatus[]> = {
  [RfpStatus.DRAFT]: [RfpStatus.OPEN, RfpStatus.CANCELLED],
  [RfpStatus.OPEN]: [RfpStatus.EVALUATION, RfpStatus.CANCELLED],
  [RfpStatus.EVALUATION]: [RfpStatus.AWARDED, RfpStatus.OPEN, RfpStatus.CANCELLED],
  [RfpStatus.AWARDED]: [],
  [RfpStatus.CANCELLED]: [],
};

export function canTransitionRfp(from: RfpStatus, to: RfpStatus): boolean {
  if (from === to) return true;
  return (RFP[from] ?? []).includes(to);
}

export enum BidStatus {
  SUBMITTED = 'SUBMITTED',
  SHORTLISTED = 'SHORTLISTED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

const BID: Record<BidStatus, BidStatus[]> = {
  [BidStatus.SUBMITTED]: [BidStatus.SHORTLISTED, BidStatus.ACCEPTED, BidStatus.REJECTED],
  [BidStatus.SHORTLISTED]: [BidStatus.ACCEPTED, BidStatus.REJECTED],
  [BidStatus.ACCEPTED]: [],
  [BidStatus.REJECTED]: [],
};

export function canTransitionBid(from: BidStatus, to: BidStatus): boolean {
  if (from === to) return true;
  return (BID[from] ?? []).includes(to);
}

export enum InviteStatus {
  SENT = 'SENT',
  RESPONDED = 'RESPONDED',
  EXPIRED = 'EXPIRED',
}
