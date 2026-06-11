import { UseGuards, applyDecorators } from '@nestjs/common';
import { Public } from './public.decorator';
import { PlatformGuard } from '../../core/platform/platform.guard';

/**
 * Composite for platform-plane controllers: bypasses the global tenant
 * JwtAuthGuard (@Public) AND enforces the platform JWT (PlatformGuard) in one
 * decorator — forgetting the second half of the manual pair left routes
 * silently open. Always use this on /platform/** controllers.
 */
export function PlatformController() {
  return applyDecorators(Public(), UseGuards(PlatformGuard));
}
