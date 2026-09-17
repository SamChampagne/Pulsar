import { Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EdiService } from './edi.service';

class Edi214QueryDto {
  /** `edi-<partner>` integration whose ISA/GS ids envelope the message. */
  @IsString()
  integrationKey!: string;
}

/**
 * Outbound EDI 214 (shipment status) for one shipment.
 *
 * Lives in ConnectModule rather than TransportationModule so the EDI plane keeps
 * a single home (and TransportationModule keeps no dependency on it), but the
 * route sits under the TMS resource and is gated exactly like its siblings:
 * `@RequireModule(TRANSPORTATION)` + `transportation.tracking.read`.
 */
@ApiTags('transportation/shipments')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/shipments')
export class EdiShipmentsController {
  constructor(private readonly edi: EdiService) {}

  /** The current 214 as raw X12 text (what a partner's translator expects). */
  @Get(':id/edi/214')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.TRACKING_READ)
  async get214(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: Edi214QueryDto,
  ): Promise<string> {
    const built = await this.edi.build214ForShipment(user.tenantId, id, query.integrationKey);
    return built.x12;
  }

  /**
   * Queues the same 214 on the webhook outbox of the integration (requires
   * `config.url`). Durable + retried — nothing is delivered synchronously here.
   */
  @Post(':id/edi/214/send')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.TRACKING_WRITE)
  send214(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: Edi214QueryDto) {
    return this.edi.send214(user.tenantId, user.id, id, query.integrationKey);
  }
}
