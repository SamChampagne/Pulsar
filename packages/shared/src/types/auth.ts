import type { PermissionKey } from '../permissions';
import type { ModuleKey } from '../modules';

/** Payload embedded in the JWT access token. */
export interface JwtPayload {
  /** User id */
  sub: string;
  tenantId: string;
  email: string;
  permissions: PermissionKey[];
  /** Platform staff flag — grants access to the cross-tenant /platform plane. */
  platformAdmin?: boolean;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  permissions: PermissionKey[];
  /** Platform staff flag — grants access to the cross-tenant /platform plane. */
  isPlatformAdmin: boolean;
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

/** Tenant summary as seen from the cross-tenant platform plane. */
export interface PlatformTenantSummary {
  id: string;
  slug: string;
  name: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  userCount: number;
  enabledModules: ModuleKey[];
}
