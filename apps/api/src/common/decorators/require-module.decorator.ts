import { SetMetadata } from '@nestjs/common';
import type { ModuleKey } from '@pulsar/shared';

export const MODULE_KEY = 'requiredModule';

/**
 * Requires the module to be enabled for the current tenant.
 * Apply at controller level on every business-module controller.
 */
export const RequireModule = (moduleKey: ModuleKey) => SetMetadata(MODULE_KEY, moduleKey);
