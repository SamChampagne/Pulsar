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
