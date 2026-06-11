import type { PermissionKey } from '../permissions';
import type { ModuleKey } from '../modules';

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

export interface PlatformAuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface PlatformLoginResponse {
  accessToken: string;
  user: PlatformAuthUser;
}
