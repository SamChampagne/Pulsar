import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsDateString, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { MrpPreparationService } from './mrp-preparation.service';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

class PreviewDto {
  @IsString() @MaxLength(200) proposalId!: string;
}
class PrepareDto extends PreviewDto {
  @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
  @IsUUID() operationKey!: string;
}
class CancelDto {
  @IsDateString() expectedUpdatedAt!: string;
}

@ApiTags('manufacturing/mrp')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/mrp')
export class MrpPreparationController {
  constructor(private readonly service: MrpPreparationService) {}

  @Get('runs/:id/preparations')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  list(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: ListQueryDto) {
    return this.service.list(user.tenantId, id, user.permissions, query);
  }

  @Get('runs/:id/preparation')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: PreviewDto) {
    return this.service.preview(user.tenantId, id, query.proposalId, user.permissions);
  }

  @Post('runs/:id/prepare')
  @RequirePermissions(
    PERMISSIONS.MANUFACTURING.READ,
    PERMISSIONS.MANUFACTURING.MANAGE,
    PERMISSIONS.WMS.READ,
  )
  prepare(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PrepareDto) {
    return this.service.prepare(user.tenantId, user.id, id, user.permissions, dto);
  }

  @Post('preparations/:id/cancel')
  @RequirePermissions(
    PERMISSIONS.MANUFACTURING.READ,
    PERMISSIONS.MANUFACTURING.MANAGE,
    PERMISSIONS.WMS.READ,
  )
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.service.cancel(user.tenantId, user.id, id, dto.expectedUpdatedAt, user.permissions);
  }
}
