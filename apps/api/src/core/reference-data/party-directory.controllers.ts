import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuditAction,
  MODULE_KEYS,
  PERMISSIONS,
  REFERENCE_ACCESS,
  type AuthUser,
} from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CreateDirectoryDto, DirectoryQueryDto, UpdateDirectoryDto } from './party-directory.dto';
import { PartyDirectoryService } from './party-directory.service';
import { DirectoryImpactService } from './directory-impact.service';
import { DirectoryImpactQueryDto } from './directory-impact.dto';

// Static consumer rights, not a client-provided resource/module or a permissive OR guard.
const accessList = [
  {
    path: 'crm/companies',
    kind: 'crm-company',
    module: MODULE_KEYS.CRM,
    read: PERMISSIONS.CRM.READ,
    manage: PERMISSIONS.CRM.MANAGE,
  },
  ...REFERENCE_ACCESS.filter((a) => ['customer', 'client', 'supplier'].includes(a.kind)),
  {
    path: 'transportation/customers',
    kind: 'customer',
    module: MODULE_KEYS.TRANSPORTATION,
    read: PERMISSIONS.TRANSPORTATION.MASTER_DATA_READ,
    manage: PERMISSIONS.TRANSPORTATION.MASTER_DATA_MANAGE,
  },
];
export const PartyDirectoryControllers = accessList.map((access) => {
  const kind = access.kind as 'customer' | 'client' | 'supplier' | 'crm-company';
  @ApiTags('party-directory')
  @ApiBearerAuth()
  @Controller(`${access.path}/:ownerId/directory`)
  @RequireModule(access.module)
  class DirectoryController {
    constructor(
      @Inject(PartyDirectoryService) private readonly directory: PartyDirectoryService,
      @Inject(DirectoryImpactService) private readonly impact: DirectoryImpactService,
    ) {}
    @Get(':id/impact')
    @RequirePermissions(access.read)
    impactView(
      @CurrentUser() u: AuthUser,
      @Param('ownerId') ownerId: string,
      @Param('id') id: string,
      @Query() q: DirectoryImpactQueryDto,
    ) {
      return this.impact.get(u, kind, ownerId, id, q);
    }
    @Get()
    @RequirePermissions(access.read)
    list(
      @CurrentUser() u: AuthUser,
      @Param('ownerId') ownerId: string,
      @Query() q: DirectoryQueryDto,
    ) {
      return this.directory.list(u.tenantId, kind, ownerId, q);
    }
    @Get(':id/history')
    @RequirePermissions(access.read)
    history(
      @CurrentUser() u: AuthUser,
      @Param('ownerId') ownerId: string,
      @Param('id') id: string,
      @Query() q: DirectoryQueryDto,
    ) {
      return this.directory.history(u.tenantId, kind, ownerId, id, q);
    }
    @Post()
    @RequirePermissions(access.read, access.manage)
    @Audit('party-directory-entry', AuditAction.CREATE)
    create(
      @CurrentUser() u: AuthUser,
      @Param('ownerId') ownerId: string,
      @Body() dto: CreateDirectoryDto,
    ) {
      return this.directory.save(u.tenantId, u.id, kind, ownerId, dto);
    }
    @Patch(':id')
    @RequirePermissions(access.read, access.manage)
    @Audit('party-directory-entry', AuditAction.UPDATE)
    update(
      @CurrentUser() u: AuthUser,
      @Param('ownerId') ownerId: string,
      @Param('id') id: string,
      @Body() dto: UpdateDirectoryDto,
    ) {
      return this.directory.save(u.tenantId, u.id, kind, ownerId, dto, id);
    }
  }
  Object.defineProperty(DirectoryController, 'name', {
    value: `Directory_${access.path.replace(/\W/g, '_')}`,
  });
  return DirectoryController;
});
