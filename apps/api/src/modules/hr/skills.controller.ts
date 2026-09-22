import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { AuditAction, AuthUser, MODULE_KEYS, PERMISSIONS as P } from '@pulsar/shared';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { HrSkillsService } from './skills.service';
import {
  CreateQualificationDto,
  CreateSkillDto,
  QualificationCheckDto,
  RequirementsDto,
  RevokeQualificationDto,
  SkillQueryDto,
  UpdateSkillDto,
} from './skills.dto';
@Controller('hr')
@RequireModule(MODULE_KEYS.HR)
export class HrSkillsController {
  constructor(private readonly s: HrSkillsService) {}
  @Get('skills') @RequirePermissions(P.HR.READ) skills(
    @CurrentUser() u: AuthUser,
    @Query() q: SkillQueryDto,
  ) {
    return this.s.skills(u.tenantId, q);
  }
  @Post('skills')
  @RequirePermissions(P.HR.READ, P.HR.MANAGE)
  @Audit('hr-skill', AuditAction.CREATE)
  create(@CurrentUser() u: AuthUser, @Body() d: CreateSkillDto) {
    return this.s.createSkill(u, d);
  }
  @Patch('skills/:id')
  @RequirePermissions(P.HR.READ, P.HR.MANAGE)
  @Audit('hr-skill', AuditAction.UPDATE)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: UpdateSkillDto) {
    return this.s.updateSkill(u, id, d);
  }
  @Get('qualifications') @RequirePermissions(P.HR.READ) qualifications(
    @CurrentUser() u: AuthUser,
    @Query() q: SkillQueryDto,
  ) {
    return this.s.qualifications(u, q);
  }
  @Post('qualifications') @RequirePermissions(P.HR.READ, P.HR.QUALIFICATIONS_MANAGE) issue(
    @CurrentUser() u: AuthUser,
    @Body() d: CreateQualificationDto,
  ) {
    return this.s.issue(u, d);
  }
  @Post('qualifications/:id/revoke')
  @RequirePermissions(P.HR.READ, P.HR.QUALIFICATIONS_MANAGE)
  revoke(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: RevokeQualificationDto) {
    return this.s.revoke(u, id, d);
  }
}
@Controller('manufacturing/qualifications')
@RequireModule(MODULE_KEYS.MANUFACTURING)
@RequirePermissions(P.MANUFACTURING.READ, P.HR.QUALIFICATIONS_READ)
export class ManufacturingQualificationsController {
  constructor(private readonly s: HrSkillsService) {}
  @Get('people') @RequirePermissions(P.MANUFACTURING.READ, P.HR.QUALIFICATIONS_READ) people(
    @CurrentUser() u: AuthUser,
    @Query() q: SkillQueryDto,
  ) {
    return this.s.people(u, q);
  }
  @Get('skills') @RequirePermissions(P.MANUFACTURING.READ, P.HR.QUALIFICATIONS_READ) async skills(
    @CurrentUser() u: AuthUser,
    @Query() q: SkillQueryDto,
  ) {
    await this.s.requireManufacturing(u);
    return this.s.skills(u.tenantId, q);
  }
  @Get('requirements/:id')
  @RequirePermissions(P.MANUFACTURING.READ, P.HR.QUALIFICATIONS_READ)
  requirements(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.s.requirements(u, id);
  }
  @Put('requirements/:id')
  @RequirePermissions(P.MANUFACTURING.READ, P.MANUFACTURING.MANAGE, P.HR.QUALIFICATIONS_READ)
  @Audit('work-center-skills', AuditAction.UPDATE)
  set(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: RequirementsDto) {
    return this.s.setRequirements(u, id, d);
  }
  @Post('check') @RequirePermissions(P.MANUFACTURING.READ, P.HR.QUALIFICATIONS_READ) check(
    @CurrentUser() u: AuthUser,
    @Body() d: QualificationCheckDto,
  ) {
    return this.s.check(u, d);
  }
}
