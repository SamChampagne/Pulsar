import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AppointmentListQueryDto, CreateAppointmentDto } from './dto/appointment.dto';
import { AppointmentsService } from './appointments.service';

@ApiTags('yard/appointments')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.YARD)
@Controller('yard/appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.YARD.READ)
  list(@CurrentUser() user: AuthUser, @Query() q: AppointmentListQueryDto) {
    return this.appointments.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.get(user.tenantId, id);
  }

  @Post()
  @Audit('dock-appointment', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAppointmentDto) {
    return this.appointments.create(user.tenantId, user.id, dto);
  }

  @Post(':id/arrive')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  arrive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.arrive(user.tenantId, user.id, id);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.complete(user.tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.cancel(user.tenantId, user.id, id);
  }

  @Post(':id/no-show')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  noShow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appointments.noShow(user.tenantId, user.id, id);
  }
}
