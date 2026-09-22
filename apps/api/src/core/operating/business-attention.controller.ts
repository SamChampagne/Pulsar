import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ATTENTION_KINDS,
  BusinessAttentionKind as AttentionKind,
  AuthUser,
  AuditAction,
  PERMISSIONS,
} from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { BusinessAttentionService } from './business-attention.service';
class AttentionQuery extends ListQueryDto {
  @IsOptional() @IsIn(ATTENTION_KINDS) kind?: AttentionKind;
  @IsOptional() @IsIn(['all', 'mine']) scope?: 'all' | 'mine';
}
class EnabledSources {
  @IsBoolean() support!: boolean;
  @IsBoolean() quality!: boolean;
  @IsBoolean() time!: boolean;
  @IsBoolean() purchasing!: boolean;
  @IsBoolean() qualifications!: boolean;
}
export class AttentionSettingsDto {
  @IsString() @MaxLength(100) timeZone!: string;
  @IsInt() @Min(0) @Max(365) qualificationDays!: number;
  @IsDefined() @ValidateNested() @Type(() => EnabledSources) enabled!: EnabledSources;
  @IsDateString() expectedUpdatedAt!: string;
}
@ApiTags('core/operating')
@ApiBearerAuth()
@Controller('operational-attention')
export class BusinessAttentionController {
  constructor(private readonly attention: BusinessAttentionService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.CORE.OPERATING_TASKS_READ)
  list(@CurrentUser() actor: AuthUser, @Query() query: AttentionQuery) {
    return this.attention.list(actor, query);
  }
  @Put('settings')
  @RequirePermissions(PERMISSIONS.CORE.TENANT_MANAGE)
  @Audit('connected-operations-settings', AuditAction.UPDATE)
  update(@CurrentUser() actor: AuthUser, @Body() dto: AttentionSettingsDto) {
    return this.attention.updateSettings(actor, dto);
  }
}
