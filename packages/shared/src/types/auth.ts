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
