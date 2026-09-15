import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { PipelinesService } from './pipelines.service';
import { CreatePipelineDto, SavePipelineDto } from './dto/pipeline.dto';

@ApiTags('crm-pipelines')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser) {
    return this.pipelines.list(user.tenantId);
  }
  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  @Audit('crm-pipeline', AuditAction.CREATE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePipelineDto) {
    return this.pipelines.create(user.tenantId, user.id, dto);
  }
  @Put(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  @Audit('crm-pipeline', AuditAction.UPDATE)
  save(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SavePipelineDto) {
    return this.pipelines.save(user.tenantId, user.id, id, dto);
  }
}
