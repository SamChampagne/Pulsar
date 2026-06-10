import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { AuditLogsService } from './audit-logs.service';

class AuditQueryDto extends ListQueryDto {
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;
}

@ApiTags('core/audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.AUDIT_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: AuditQueryDto) {
    return this.auditLogs.list(user.tenantId, query);
  }
}
