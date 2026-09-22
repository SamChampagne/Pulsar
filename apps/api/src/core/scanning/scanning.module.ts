import { BadRequestException, Body, Controller, Injectable, Module, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { MODULE_KEYS, PERMISSIONS, SCAN_KINDS, type AuthUser, type ScanKind } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ScanningService } from './scanning.service';

class ScanDto {
  @IsIn(SCAN_KINDS) kind!: ScanKind;
  @IsString() @Length(1, 132) code!: string;
  @IsOptional() @IsString() @MaxLength(100) locationId?: string;
}
@Injectable()
class ScanController {
  constructor(protected readonly service: ScanningService) {}
  read(u: AuthUser, dto: ScanDto, allowed: ScanKind[]) {
    if (!allowed.includes(dto.kind))
      throw new BadRequestException('Type de scan incompatible avec ce module.');
    return this.service.resolve(u.tenantId, dto.kind, dto.code, dto.locationId);
  }
}
@Controller('scan/wms')
@RequireModule(MODULE_KEYS.WMS)
class WmsScanController extends ScanController {
  @Post()
  @RequirePermissions(PERMISSIONS.WMS.READ)
  scan(@CurrentUser() u: AuthUser, @Body() dto: ScanDto) {
    return this.read(u, dto, ['item', 'bin']);
  }
}
@Controller('scan/transport')
@RequireModule(MODULE_KEYS.TRANSPORTATION)
class TransportScanController extends ScanController {
  @Post()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  scan(@CurrentUser() u: AuthUser, @Body() dto: ScanDto) {
    return this.read(u, dto, ['load', 'shipment']);
  }
}
@Controller('scan/manufacturing')
@RequireModule(MODULE_KEYS.MANUFACTURING)
class ManufacturingScanController extends ScanController {
  @Post()
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  scan(@CurrentUser() u: AuthUser, @Body() dto: ScanDto) {
    return this.read(u, dto, ['manufacturing-order']);
  }
}
@Controller('scan/yard')
@RequireModule(MODULE_KEYS.YARD)
class YardScanController extends ScanController {
  @Post()
  @RequirePermissions(PERMISSIONS.YARD.READ)
  scan(@CurrentUser() u: AuthUser, @Body() dto: ScanDto) {
    return this.read(u, dto, ['yard-visit', 'dock-appointment']);
  }
}
@Controller('scan/fleet')
@RequireModule(MODULE_KEYS.FLEET)
class FleetScanController extends ScanController {
  @Post()
  @RequirePermissions(PERMISSIONS.FLEET.READ)
  scan(@CurrentUser() u: AuthUser, @Body() dto: ScanDto) {
    return this.read(u, dto, ['vehicle', 'trailer']);
  }
}
@Module({
  controllers: [
    WmsScanController,
    TransportScanController,
    ManufacturingScanController,
    YardScanController,
    FleetScanController,
  ],
  providers: [ScanningService],
})
export class ScanningModule {}
