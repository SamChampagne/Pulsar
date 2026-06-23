import { describe, it, expect } from 'vitest';
import { CrmCampaignStatus, CrmDealStage, canTransitionDeal, isDealOpen } from './crm.workflow';

describe('canTransitionDeal', () => {
  it('moves freely among active stages', () => {
    expect(canTransitionDeal(CrmDealStage.LEAD, CrmDealStage.QUALIFIED)).toBe(true);
    expect(canTransitionDeal(CrmDealStage.PROPOSAL, CrmDealStage.QUALIFIED)).toBe(true); // back ok
  });
  it('active stages can close to WON or LOST', () => {
    expect(canTransitionDeal(CrmDealStage.PROPOSAL, CrmDealStage.WON)).toBe(true);
    expect(canTransitionDeal(CrmDealStage.LEAD, CrmDealStage.LOST)).toBe(true);
  });
  it('WON and LOST are terminal', () => {
    expect(canTransitionDeal(CrmDealStage.WON, CrmDealStage.PROPOSAL)).toBe(false);
    expect(canTransitionDeal(CrmDealStage.LOST, CrmDealStage.LEAD)).toBe(false);
    expect(canTransitionDeal(CrmDealStage.WON, CrmDealStage.LOST)).toBe(false);
  });
  it('no-op transition is false', () => {
    expect(canTransitionDeal(CrmDealStage.LEAD, CrmDealStage.LEAD)).toBe(false);
  });
});

describe('isDealOpen', () => {
  it('open for active stages, closed for terminal', () => {
    expect(isDealOpen(CrmDealStage.LEAD)).toBe(true);
    expect(isDealOpen(CrmDealStage.WON)).toBe(false);
    expect(isDealOpen(CrmDealStage.LOST)).toBe(false);
  });
});

describe('CrmCampaignStatus', () => {
  it('has DRAFT, SENDING, SENT values', () => {
    expect(CrmCampaignStatus.DRAFT).toBe('DRAFT');
    expect(CrmCampaignStatus.SENDING).toBe('SENDING');
    expect(CrmCampaignStatus.SENT).toBe('SENT');
  });
});
