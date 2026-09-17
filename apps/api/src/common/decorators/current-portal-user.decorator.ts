import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PortalAuthUser } from '@pulsar/shared';

/** Injects the authenticated portal account (populated by PortalGuard) into a handler parameter. */
export const CurrentPortalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PortalAuthUser => {
    return ctx.switchToHttp().getRequest().portalUser;
  },
);
