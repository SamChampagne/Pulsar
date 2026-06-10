import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@pulsar/shared';

export const PERMISSIONS_KEY = 'requiredPermissions';

/** Requires the authenticated user to hold ALL of the given permissions. */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
