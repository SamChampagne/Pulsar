/**
 * Customer portal accounts (Task 5 of "Comptes portail client + fil « Quoi de neuf »").
 * Pure data: enums are mirrored in schema.prisma with identical value names (rule 3).
 * Not related to `User`/`CrmContact` — a portal account is a standalone identity scoped
 * to a tenant + customer.
 */
export enum PortalUserRole {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export enum PortalUserStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export enum PortalActionTokenKind {
  INVITATION = 'INVITATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

/**
 * Portal change requests (Task B1 of "Aide à la saisie + portail v2 + connecteurs", spec §B2.2).
 * A customer-portal user asks staff to change a date, an address, cancel an order/shipment, or
 * something else (`OTHER`) — persisted so staff can track and respond to it.
 */
export enum PortalChangeRequestKind {
  DATE = 'DATE',
  ADDRESS = 'ADDRESS',
  CANCEL = 'CANCEL',
  OTHER = 'OTHER',
}

export enum PortalChangeRequestStatus {
  OPEN = 'OPEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

const PORTAL_CHANGE_REQUEST_TRANSITIONS: Record<
  PortalChangeRequestStatus,
  PortalChangeRequestStatus[]
> = {
  [PortalChangeRequestStatus.OPEN]: [
    PortalChangeRequestStatus.ACKNOWLEDGED,
    PortalChangeRequestStatus.RESOLVED,
    PortalChangeRequestStatus.REJECTED,
  ],
  [PortalChangeRequestStatus.ACKNOWLEDGED]: [
    PortalChangeRequestStatus.RESOLVED,
    PortalChangeRequestStatus.REJECTED,
  ],
  [PortalChangeRequestStatus.RESOLVED]: [],
  [PortalChangeRequestStatus.REJECTED]: [],
};

export function canTransitionPortalChangeRequest(
  from: PortalChangeRequestStatus,
  to: PortalChangeRequestStatus,
): boolean {
  return PORTAL_CHANGE_REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}
