import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@pulsar/shared';

/** Injects the authenticated user (populated by JwtStrategy) into a handler parameter. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
