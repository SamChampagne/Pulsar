import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ADMIN_KEY = 'requiresPlatformAdmin';

/**
 * Marks an endpoint as part of the cross-tenant platform plane: only users with
 * the `isPlatformAdmin` flag may call it (see PlatformAdminGuard). Such endpoints
 * operate across tenants and take an explicit `:tenantId` — they never derive the
 * tenant scope from the caller, so per-tenant isolation elsewhere is unaffected.
 */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true);
