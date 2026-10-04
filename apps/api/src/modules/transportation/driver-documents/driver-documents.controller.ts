import { Body, Controller, Get, Header, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { IssueDriverDocumentDto } from './driver-documents.dto';
import { DriverDocumentsService } from './driver-documents.service';

function sendPdf(res: Response, file: { body: Buffer; fileName: string }) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${file.fileName}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.send(file.body);
}

@ApiTags('transportation/driver-documents')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.TRANSPORTATION)
@Controller('transportation/loads/:loadId/driver-documents')
export class DriverDocumentsController {
  constructor(private readonly service: DriverDocumentsService) {}
  @Get('preview')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  preview(@CurrentUser() u: AuthUser, @Param('loadId') loadId: string) {
    return this.service.preview(u.tenantId, loadId);
  }
  @Get()
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  list(@CurrentUser() u: AuthUser, @Param('loadId') loadId: string, @Query() query: ListQueryDto) {
    return this.service.list(u.tenantId, loadId, query);
  }
  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  detail(@CurrentUser() u: AuthUser, @Param('loadId') loadId: string, @Param('id') id: string) {
    return this.service.detail(u.tenantId, loadId, id);
  }
  @Post()
  @RequirePermissions(
    PERMISSIONS.TRANSPORTATION.PLANNING_READ,
    PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE,
  )
  issue(
    @CurrentUser() u: AuthUser,
    @Param('loadId') loadId: string,
    @Body() dto: IssueDriverDocumentDto,
  ) {
    return this.service.issue(u.tenantId, u.id, loadId, dto);
  }
  @Post(':id/file')
  @RequirePermissions(
    PERMISSIONS.TRANSPORTATION.PLANNING_READ,
    PERMISSIONS.TRANSPORTATION.PLANNING_MANAGE,
  )
  prepare(@CurrentUser() u: AuthUser, @Param('loadId') loadId: string, @Param('id') id: string) {
    return this.service.prepareFile(u.tenantId, u.id, loadId, id);
  }
  @Get(':id/file')
  @RequirePermissions(PERMISSIONS.TRANSPORTATION.PLANNING_READ)
  async download(
    @CurrentUser() u: AuthUser,
    @Param('loadId') loadId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    sendPdf(res, await this.service.download(u.tenantId, loadId, id));
  }
}

@Public()
@Controller('public/driver/:token/documents')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PublicDriverDocumentsController {
  constructor(private readonly service: DriverDocumentsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  list(@Param('token') token: string) {
    return this.service.publicList(token);
  }
  @Get(':ref/file')
  async download(@Param('token') token: string, @Param('ref') ref: string, @Res() res: Response) {
    sendPdf(res, await this.service.publicDownload(token, ref));
  }
}
