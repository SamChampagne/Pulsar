import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AuthUser, MODULE_KEYS, PERMISSIONS, ServiceAcceptanceStatus } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ServicesAcceptanceService } from './services-acceptance.service';

const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
export class RecordServiceAcceptanceDto {
  @IsUUID() operationKey!: string;
  @IsDateString() expectedUpdatedAt!: string;
  @IsIn(['RESERVATIONS', 'ACCEPTED']) status!: ServiceAcceptanceStatus;
  @IsString() @Trim() @Length(1, 200) representative!: string;
  @IsString() @Trim() @Length(1, 500) reference!: string;
  @IsString() @Trim() @Length(1, 4000) note!: string;
  @Equals(true) confirm!: boolean;
}
class HistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
@Controller('services/jobs/:jobId/acceptance')
@RequireModule(MODULE_KEYS.SERVICES)
export class ServicesAcceptanceController {
  constructor(private readonly service: ServicesAcceptanceService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  history(@CurrentUser() actor: AuthUser, @Param('jobId') id: string, @Query() q: HistoryQueryDto) {
    return this.service.history(actor.tenantId, id, q.page);
  }
  @Post()
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.SERVICES.WORK_ACCEPT)
  record(
    @CurrentUser() actor: AuthUser,
    @Param('jobId') id: string,
    @Body() dto: RecordServiceAcceptanceDto,
  ) {
    return this.service.record(actor, id, dto);
  }
}
