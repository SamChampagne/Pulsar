import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, CustomFieldEntity, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CustomFieldsService } from '../../../core/custom-fields/custom-fields.service';
import { ReplaceCustomFieldsDto } from '../../../core/custom-fields/dto/custom-field.dto';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/custom-fields')
export class BillingCustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CORE.MODULES_READ)
  list(@CurrentUser() user: AuthUser, @Query('entityType') entityType: CustomFieldEntity) {
    return this.service.listDefinitions('billing', user.tenantId, entityType);
  }

  @Put()
  @Audit('custom-field-definition', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.CORE.MODULES_MANAGE)
  replace(@CurrentUser() user: AuthUser, @Body() dto: ReplaceCustomFieldsDto) {
    return this.service.replaceDefinitions('billing', user.tenantId, dto.entityType, dto.definitions as never);
  }
}
