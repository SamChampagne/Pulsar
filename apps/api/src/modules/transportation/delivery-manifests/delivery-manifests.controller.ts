import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { IssueDeliveryManifestDto } from './delivery-manifests.dto';
import { DeliveryManifestsService } from './delivery-manifests.service';

@ApiTags('transportation/delivery-manifests')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/loads/:loadId/manifests')
export class DeliveryManifestsController {
  constructor(private readonly manifests: DeliveryManifestsService) {}

  @Get('preview')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  preview(@CurrentUser() u: AuthUser, @Param('loadId') loadId: string) {
    return this.manifests.preview(u.tenantId, loadId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() u: AuthUser, @Param('loadId') loadId: string, @Query() query: ListQueryDto) {
    return this.manifests.list(u.tenantId, loadId, query);
  }

  @Post()
  @RequirePermissions(
    PERMISSIONS.TRANSPORTATION.PLANNING_READ,
    PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE,
  )
  issue(
    @CurrentUser() u: AuthUser,
    @Param('loadId') loadId: string,
    @Body() dto: IssueDeliveryManifestDto,
  ) {
    return this.manifests.issue(u.tenantId, u.id, loadId, dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  detail(@CurrentUser() u: AuthUser, @Param('loadId') loadId: string, @Param('id') id: string) {
    return this.manifests.detail(u.tenantId, loadId, id);
  }

  @Post(':id/files/:kind')
  @RequirePermissions(
    PERMISSIONS.TRANSPORTATION.PLANNING_READ,
    PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE,
  )
  prepare(
    @CurrentUser() u: AuthUser,
    @Param('loadId') loadId: string,
    @Param('id') id: string,
    @Param('kind') kind: string,
  ) {
    return this.manifests.prepareFile(u.tenantId, u.id, loadId, id, kind);
  }

  @Get(':id/files/:kind')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  async download(
    @CurrentUser() u: AuthUser,
    @Param('loadId') loadId: string,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Res() res: Response,
  ) {
    const file = await this.manifests.download(u.tenantId, loadId, id, kind);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(file.body);
  }
}
