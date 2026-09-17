import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDate, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ApiKeysService } from './api-keys.service';

class CreateApiKeyDto {
  @IsString()
  name!: string;

  /** Permission keys, e.g. ["transportation.orders.read"]. */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scopes!: string[];

  /** Optional expiry (ISO date) — must be in the future. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

@ApiTags('core/api-keys')
@ApiBearerAuth()
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.API_KEYS_READ)
  list(@CurrentUser() user: AuthUser) {
    return this.apiKeys.list(user.tenantId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CORE.API_KEYS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(user.tenantId, user.id, dto.name, dto.scopes, dto.expiresAt);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CORE.API_KEYS_MANAGE)
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.apiKeys.revoke(user.tenantId, id);
  }
}
