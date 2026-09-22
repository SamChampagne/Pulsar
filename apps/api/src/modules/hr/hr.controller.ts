import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { HrService } from './hr.service';
import {
  CreateEmployeeDto,
  CreateLeaveDto,
  CreateTeamDto,
  HrQueryDto,
  LeaveTransitionDto,
  UpdateEmployeeDto,
  UpdateLeaveDto,
  UpdateTeamDto,
} from './hr.dto';
const Read = () => RequirePermissions(PERMISSIONS.HR.READ);
const Manage = () => RequirePermissions(PERMISSIONS.HR.READ, PERMISSIONS.HR.MANAGE);
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr')
@RequireModule(MODULE_KEYS.HR)
export class HrController {
  constructor(private readonly s: HrService) {}
  @Get('people') @Read() people(@CurrentUser() u: AuthUser, @Query() q: HrQueryDto) {
    return this.s.people(u.tenantId, q);
  }
  @Get('teams') @Read() teams(@CurrentUser() u: AuthUser, @Query() q: HrQueryDto) {
    return this.s.teams(u.tenantId, q);
  }
  @Post('teams') @Manage() @Audit('hr-team', AuditAction.CREATE) createTeam(
    @CurrentUser() u: AuthUser,
    @Body() d: CreateTeamDto,
  ) {
    return this.s.createTeam(u, d);
  }
  @Patch('teams/:id') @Manage() @Audit('hr-team', AuditAction.UPDATE) updateTeam(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: UpdateTeamDto,
  ) {
    return this.s.updateTeam(u, id, d);
  }
  @Get('employees') @Read() employees(@CurrentUser() u: AuthUser, @Query() q: HrQueryDto) {
    return this.s.employees(u.tenantId, q);
  }
  @Post('employees') @Manage() @Audit('hr-employee', AuditAction.CREATE) createEmployee(
    @CurrentUser() u: AuthUser,
    @Body() d: CreateEmployeeDto,
  ) {
    return this.s.createEmployee(u, d);
  }
  @Patch('employees/:id') @Manage() @Audit('hr-employee', AuditAction.UPDATE) updateEmployee(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: UpdateEmployeeDto,
  ) {
    return this.s.updateEmployee(u, id, d);
  }
  @Get('leaves') @Read() leaves(@CurrentUser() u: AuthUser, @Query() q: HrQueryDto) {
    return this.s.leaves(u, q);
  }
  @Get('leaves/:id') @Read() leave(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.s.detail(u, id);
  }
  @Get('leaves/:id/history') @Read() history(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query() q: HrQueryDto,
  ) {
    return this.s.history(u, id, q);
  }
  @Post('leaves') @Manage() createLeave(@CurrentUser() u: AuthUser, @Body() d: CreateLeaveDto) {
    return this.s.createLeave(u, d);
  }
  @Patch('leaves/:id') @Manage() updateLeave(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: UpdateLeaveDto,
  ) {
    return this.s.updateLeave(u, id, d);
  }
  // Per-action manage/approve permission is checked inside the transaction against the current state.
  @Post('leaves/:id/transition') @Read() transition(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: LeaveTransitionDto,
  ) {
    return this.s.transition(u, id, d);
  }
}
@ApiTags('hr-self')
@ApiBearerAuth()
@Controller('hr/self')
@RequireModule(MODULE_KEYS.HR)
@RequirePermissions(PERMISSIONS.HR.SELF)
export class HrSelfController {
  constructor(private readonly s: HrService) {}
  @Get() @RequirePermissions(PERMISSIONS.HR.SELF) me(@CurrentUser() u: AuthUser) {
    return this.s.me(u);
  }
  @Get('leaves') @RequirePermissions(PERMISSIONS.HR.SELF) leaves(
    @CurrentUser() u: AuthUser,
    @Query() q: HrQueryDto,
  ) {
    return this.s.leaves(u, q, true);
  }
  @Get('leaves/:id') @RequirePermissions(PERMISSIONS.HR.SELF) leave(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.s.detail(u, id, true);
  }
  @Get('leaves/:id/history') @RequirePermissions(PERMISSIONS.HR.SELF) history(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query() q: HrQueryDto,
  ) {
    return this.s.history(u, id, q, true);
  }
  @Post('leaves') @RequirePermissions(PERMISSIONS.HR.SELF) createLeave(
    @CurrentUser() u: AuthUser,
    @Body() d: CreateLeaveDto,
  ) {
    return this.s.createLeave(u, d, true);
  }
  @Patch('leaves/:id') @RequirePermissions(PERMISSIONS.HR.SELF) updateLeave(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: UpdateLeaveDto,
  ) {
    return this.s.updateLeave(u, id, d, true);
  }
  @Post('leaves/:id/transition') @RequirePermissions(PERMISSIONS.HR.SELF) transition(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: LeaveTransitionDto,
  ) {
    return this.s.transition(u, id, d, true);
  }
}
