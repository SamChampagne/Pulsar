import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { SimulateRateDto } from './dto/simulate-rate.dto';
import { RatingService } from './rating.service';

@ApiTags('transportation/rating')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/rating')
export class RatingController {
  constructor(private readonly rating: RatingService) {}

  /**
   * Read-only rate simulation for a hypothetical scenario (no load): evaluates and ranks
   * every matching rate. Same read permission as GET /transportation/rates.
   */
  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.RATES_READ)
  simulate(@CurrentUser() user: AuthUser, @Body() dto: SimulateRateDto) {
    return this.rating.simulate(user.tenantId, dto);
  }
}
