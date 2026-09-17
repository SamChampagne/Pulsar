import type { PermissionKey } from '../permissions';
import type { ModuleKey } from '../modules';
import type { PortalUserRole } from '../portal/portal';

/** Payload embedded in the JWT access token. */
export interface JwtPayload {
  /** User id */
  sub: string;
  tenantId: string;
  email: string;
  permissions: PermissionKey[];
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  permissions: PermissionKey[];
}

export interface LoginResponse {
  accessToken: string;
  /** Opaque rotating token — exchange at POST /auth/refresh for a new pair. */
  refreshToken: string;
  user: AuthUser;
  tenant: {
    id: string;
    slug: string;
    name: string;
    enabledModules: ModuleKey[];
  };
}

/** Payload of a platform-plane access token. Tenant guards MUST reject it. */
export interface PlatformJwtPayload {
  /** PlatformUser id */
  sub: string;
  email: string;
  platformAdmin: true;
}

/**
 * Payload of a step token (not a full access token).
 * Strategy MUST reject any payload with a scope property.
 */
export interface PlatformStepTokenPayload {
  sub: string;
  email: string;
  /** 'mfa-pending' | 'mfa-enroll' */
  scope: string;
  /** Present only on mfa-enroll tokens — encrypted TOTP secret. */
  secretEnc?: string;
}

export interface PlatformAuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

/** Normal login — full access token issued. */
export interface PlatformLoginResponseSuccess {
  accessToken: string;
  user: PlatformAuthUser;
}

/** Account has MFA enabled — step token required to complete login. */
export interface PlatformLoginResponseMfaRequired {
  mfaRequired: true;
  mfaToken: string;
}

/** MFA not yet enrolled and PLATFORM_MFA_ENFORCED=true — enrollment required before access. */
export interface PlatformLoginResponseEnrollmentRequired {
  mfaEnrollmentRequired: true;
  enrollToken: string;
  otpauthUrl: string;
}

export type PlatformLoginResponse =
  | PlatformLoginResponseSuccess
  | PlatformLoginResponseMfaRequired
  | PlatformLoginResponseEnrollmentRequired;

/** Payload of a customer-portal-plane access token. Tenant and platform guards MUST reject it. */
export interface PortalJwtPayload {
  /** PortalUser id */
  sub: string;
  tenantId: string;
  customerId: string;
  email: string;
  role: PortalUserRole;
  portal: true;
}

export interface PortalAuthUser {
  id: string;
  tenantId: string;
  customerId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: PortalUserRole;
}

export interface PortalLoginResponse {
  accessToken: string;
  /** Opaque rotating token — exchange at POST /portal/auth/refresh for a new pair. */
  refreshToken: string;
  user: PortalAuthUser;
  customer: {
    id: string;
    name: string;
  };
  shipper: {
    name: string;
  };
  branding: {
    logoUrl?: string;
    accentColor?: string;
  };
}
