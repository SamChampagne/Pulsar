import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ComplianceListQueryDto, CreateComplianceDocumentDto } from './dto/compliance.dto';
import { ComplianceService } from './compliance.service';

@ApiTags('fleet/compliance')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.FLEET)
@Controller('fleet/compliance-documents')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ComplianceListQueryDto) {
    return this.compliance.list(user.tenantId, query);
  }

  // Must precede ':id' so the literal segment is not captured as an id.
  @Get('expiring')
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  expiring(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    const window = days ? Number.parseInt(days, 10) : 30;
    return this.compliance.expiring(
      user.tenantId,
      Number.isFinite(window) && window > 0 ? window : 30,
    );
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.compliance.get(user.tenantId, id);
  }

  @Post()
  @Audit('compliance-document', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateComplianceDocumentDto) {
    return this.compliance.create(user.tenantId, user.id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.compliance.remove(user.tenantId, user.id, id);
  }
}
