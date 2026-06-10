import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ApiKeysService } from '../../core/api-keys/api-keys.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeysService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Machine-to-machine path: X-Api-Key replaces the JWT entirely.
    const request = context.switchToHttp().getRequest();
    const rawKey = request.headers['x-api-key'];
    if (typeof rawKey === 'string' && rawKey.length > 0) {
      request.user = await this.apiKeys.validate(rawKey);
      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
  }
}
