import { UseGuards, applyDecorators } from '@nestjs/common';
import { PortalGuard } from '../../modules/customer-portal/auth/portal.guard';
import { Public } from './public.decorator';

/**
 * Composite for customer-portal-plane controllers: bypasses the global tenant
 * JwtAuthGuard (@Public) AND enforces the portal JWT (PortalGuard) in one
 * decorator — same reason as @PlatformController: forgetting the second half
 * of the manual pair leaves routes silently open. Always use this on
 * session-authenticated /portal/** controllers.
 */
export function PortalController() {
  return applyDecorators(Public(), UseGuards(PortalGuard));
}
