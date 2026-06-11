import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import type { Response } from 'express';
import { IsBoolean, IsString } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { OidcService } from './oidc.service';

class OidcConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  issuer!: string;

  @IsString()
  clientId!: string;

  @IsString()
  clientSecret!: string;

  @IsString()
  defaultRoleId!: string;
}

class OidcExchangeDto {
  @IsString()
  code!: string;
}

@ApiTags('auth')
@Controller('auth')
export class OidcController {
  constructor(private readonly oidc: OidcService) {}

  @Get('oidc-config')
  @RequirePermissions(PERMISSIONS.CORE.TENANT_MANAGE)
  getConfig(@CurrentUser() user: AuthUser) {
    return this.oidc.getConfig(user.tenantId);
  }

  @Put('oidc-config')
  @RequirePermissions(PERMISSIONS.CORE.TENANT_MANAGE)
  putConfig(@CurrentUser() user: AuthUser, @Body() dto: OidcConfigDto) {
    return this.oidc.putConfig(user.tenantId, user.id, dto);
  }

  @Public()
  @Get('oidc/:tenantSlug')
  async start(@Param('tenantSlug') slug: string, @Res() res: Response) {
    res.redirect(await this.oidc.start(slug));
  }

  @Public()
  @Get('oidc/:tenantSlug/callback')
  async callback(
    @Param('tenantSlug') slug: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    res.redirect(await this.oidc.callback(slug, query));
  }

  @Public()
  @Post('oidc/exchange')
  exchange(@Body() dto: OidcExchangeDto) {
    return this.oidc.exchange(dto.code);
  }
}
