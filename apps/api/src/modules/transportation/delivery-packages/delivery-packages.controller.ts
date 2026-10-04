import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DeliveryPackageStatus, MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  CreateDeliveryPackageDto,
  EditDeliveryPackageDto,
  PackageListDto,
  TransitionDeliveryPackageDto,
} from './delivery-packages.dto';
import { DeliveryPackagesService } from './delivery-packages.service';

@ApiTags('transportation/delivery-packages')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/delivery-packages')
export class DeliveryPackagesController {
  constructor(private readonly packages: DeliveryPackagesService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: PackageListDto) {
    return this.packages.list(user.tenantId, query.loadId);
  }
  @Get(':id/events')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  events(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.packages.events(user.tenantId, id);
  }
  @Post('shipment/:id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateDeliveryPackageDto,
  ) {
    return this.packages.create(user.tenantId, user.id, id, dto);
  }
  @Patch(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: EditDeliveryPackageDto,
  ) {
    return this.packages.edit(user.tenantId, user.id, id, dto);
  }
  @Post(':id/transition')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.EXECUTION_MANAGE)
  transition(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: TransitionDeliveryPackageDto,
  ) {
    if (
      dto.target === DeliveryPackageStatus.CANCELLED &&
      !user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE)
    )
      throw new ForbiddenException('La modification du contenu exige le droit de planification.');
    return this.packages.transition(user.tenantId, user.id, id, dto);
  }
}
