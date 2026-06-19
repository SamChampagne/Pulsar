import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PlanningBoardService } from './planning-board.service';

@ApiTags('transportation/planning-board')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/planning-board')
export class PlanningBoardController {
  constructor(private readonly planningBoard: PlanningBoardService) {}

  /** Read-only aggregation: unassigned shipments, open loads (with capacity), resource pool. */
  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  getBoard(@CurrentUser() user: AuthUser) {
    return this.planningBoard.getBoard(user.tenantId);
  }
}
