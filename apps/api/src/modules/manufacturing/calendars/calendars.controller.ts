import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { CalendarsService } from './calendars.service';
import { CreateCalendarDto, CreateShiftDto, UpdateCalendarDto } from './dto/calendar.dto';

@ApiTags('manufacturing/calendars')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/calendars')
export class CalendarsController {
  constructor(private readonly calendars: CalendarsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.calendars.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendars.get(user.tenantId, id);
  }

  @Post()
  @Audit('working-calendar', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCalendarDto) {
    return this.calendars.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('working-calendar', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCalendarDto) {
    return this.calendars.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendars.remove(user.tenantId, id);
  }

  @Get(':id/shifts')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  listShifts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendars.listShifts(user.tenantId, id);
  }

  @Post(':id/shifts')
  @Audit('work-center-shift', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  addShift(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateShiftDto) {
    return this.calendars.addShift(user.tenantId, id, dto);
  }

  @Delete(':id/shifts/:shiftId')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  removeShift(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('shiftId') shiftId: string,
  ) {
    return this.calendars.removeShift(user.tenantId, id, shiftId);
  }
}
