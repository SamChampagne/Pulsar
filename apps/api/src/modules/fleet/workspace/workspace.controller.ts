import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CustomFieldEntity,
  MODULE_KEYS,
  PERMISSIONS,
  type AuthUser,
  type FleetAssetKind,
} from '@pulsar/shared';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { FleetWorkspaceService } from './workspace.service';
import { FleetAgendaQuery, FleetWorkspaceQuery } from './workspace.dto';
@ApiTags('fleet/workspace')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.FLEET)
@RequirePermissions(PERMISSIONS.FLEET.READ)
@Controller('fleet/workspace')
export class FleetWorkspaceController {
  constructor(
    private readonly service: FleetWorkspaceService,
    private readonly fields: CustomFieldsService,
  ) {}
  @Get('order-fields')
  @RequirePermissions(PERMISSIONS.FLEET.MANAGE)
  orderFields(@CurrentUser() u: AuthUser) {
    return this.fields.listDefinitions('fleet', u.tenantId, CustomFieldEntity.MAINTENANCE_ORDER);
  }
  @Get()
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  workspace(@CurrentUser() u: AuthUser, @Query() q: FleetWorkspaceQuery) {
    return this.service.workspace(u.tenantId, q);
  }
  @Get('orders')
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  agenda(@CurrentUser() u: AuthUser, @Query() q: FleetAgendaQuery) {
    return this.service.agenda(u.tenantId, q);
  }
  @Get('assets/:kind/:id')
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  asset(@CurrentUser() u: AuthUser, @Param('kind') kind: FleetAssetKind, @Param('id') id: string) {
    return this.service.asset(u, kind, id);
  }
}
