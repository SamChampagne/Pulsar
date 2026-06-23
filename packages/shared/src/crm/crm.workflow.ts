// Pure, browser-safe. No Node imports.
export enum CrmCompanyStatus {
  PROSPECT = 'PROSPECT',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum CrmDealStage {
  LEAD = 'LEAD',
  QUALIFIED = 'QUALIFIED',
  PROPOSAL = 'PROPOSAL',
  WON = 'WON',
  LOST = 'LOST',
}

export enum CrmActivityType {
  NOTE = 'NOTE',
  CALL = 'CALL',
  EMAIL = 'EMAIL',
  MEETING = 'MEETING',
  TASK = 'TASK',
}

const ACTIVE_STAGES: CrmDealStage[] = [CrmDealStage.LEAD, CrmDealStage.QUALIFIED, CrmDealStage.PROPOSAL];

export function isDealOpen(stage: CrmDealStage): boolean {
  return ACTIVE_STAGES.includes(stage);
}

export enum CrmCampaignStatus {
  DRAFT = 'DRAFT',
  SENDING = 'SENDING',
  SENT = 'SENT',
}

/** Active stages move freely among themselves and can close to WON/LOST. Terminal stages never transition. */
export function canTransitionDeal(from: CrmDealStage, to: CrmDealStage): boolean {
  if (from === to) return false;
  if (!isDealOpen(from)) return false; // WON/LOST terminal
  if (isDealOpen(to)) return true; // any active -> any other active
  return to === CrmDealStage.WON || to === CrmDealStage.LOST;
}
