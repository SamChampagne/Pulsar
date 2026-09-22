import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { QualityService } from './quality.service';
import {
  CreatePlanDto,
  UpdatePlanDto,
  QualityQueryDto,
  CreateInspectionDto,
  ResultsDto,
  InspectionTransitionDto,
  NonconformityUpdateDto,
  NonconformityTransitionDto,
  QualityAssignmentDto,
  QualityEvidenceDto,
} from './quality.dto';
const Read = () => RequirePermissions(PERMISSIONS.QUALITY.READ);
const Manage = () => RequirePermissions(PERMISSIONS.QUALITY.READ, PERMISSIONS.QUALITY.MANAGE);
@ApiTags('quality')
@ApiBearerAuth()
@Controller('quality')
@RequireModule(MODULE_KEYS.QUALITY)
export class QualityController {
  constructor(private readonly service: QualityService) {}
  @Get('people') @Read() people(@CurrentUser() u: AuthUser, @Query() q: QualityQueryDto) {
    return this.service.people(u.tenantId, q);
  }
  @Patch('nonconformities/:id/assignment') @Manage() assign(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: QualityAssignmentDto,
  ) {
    return this.service.assign(u, id, dto);
  }
  @Get('nonconformities/:id/evidence') @Read() evidence(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.evidence(u, id);
  }
  @Post('nonconformities/:id/evidence')
  @Manage()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadEvidence(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: QualityEvidenceDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.uploadEvidence(u, id, dto, file);
  }
  @Get('nonconformities/:id/evidence/:evidenceId/download') @Read() async downloadEvidence(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ) {
    const result = await this.service.evidenceDownload(u, id, evidenceId);
    return new StreamableFile(result.stream, {
      type: 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    });
  }
  @Get('plans') @Read() plans(@CurrentUser() u: AuthUser, @Query() q: QualityQueryDto) {
    return this.service.plans(u.tenantId, q);
  }
  @Get('plans/:id') @Read() plan(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.plan(u.tenantId, id);
  }
  @Post('plans') @Manage() @Audit('quality-plan', AuditAction.CREATE) createPlan(
    @CurrentUser() u: AuthUser,
    @Body() d: CreatePlanDto,
  ) {
    return this.service.createPlan(u, d);
  }
  @Patch('plans/:id') @Manage() @Audit('quality-plan', AuditAction.UPDATE) updatePlan(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: UpdatePlanDto,
  ) {
    return this.service.updatePlan(u, id, d);
  }
  @Get('references') @Read() references(@CurrentUser() u: AuthUser, @Query() q: QualityQueryDto) {
    return this.service.references(u, q);
  }
  @Get('summary') @Read() summary(@CurrentUser() u: AuthUser) {
    return this.service.summary(u.tenantId);
  }
  @Get('inspections') @Read() inspections(@CurrentUser() u: AuthUser, @Query() q: QualityQueryDto) {
    return this.service.inspections(u.tenantId, q);
  }
  @Get('inspections/:id') @Read() inspection(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.inspection(u, id);
  }
  @Get('inspections/:id/history') @Read() history(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Query() q: QualityQueryDto,
  ) {
    return this.service.history(u, id, q);
  }
  @Post('inspections') @Manage() createInspection(
    @CurrentUser() u: AuthUser,
    @Body() d: CreateInspectionDto,
  ) {
    return this.service.createInspection(u, d);
  }
  @Patch('inspections/:id/results') @Manage() results(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: ResultsDto,
  ) {
    return this.service.results(u, id, d);
  }
  @Post('inspections/:id/transition') @Manage() transition(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: InspectionTransitionDto,
  ) {
    return this.service.transition(u, id, d);
  }
  @Get('nonconformities') @Read() nonconformities(
    @CurrentUser() u: AuthUser,
    @Query() q: QualityQueryDto,
  ) {
    return this.service.nonconformities(u.tenantId, q, u.id);
  }
  @Get('nonconformities/:id') @Read() nonconformity(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    return this.service.nonconformity(u.tenantId, id);
  }
  @Patch('nonconformities/:id') @Manage() updateNC(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: NonconformityUpdateDto,
  ) {
    return this.service.updateNonconformity(u, id, d);
  }
  @Post('nonconformities/:id/transition') @Manage() transitionNC(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: NonconformityTransitionDto,
  ) {
    return this.service.updateNonconformity(u, id, d);
  }
}
