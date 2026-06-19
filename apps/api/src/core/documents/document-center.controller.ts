import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DocumentCenterService } from './document-center.service';
import { DocumentCenterQueryDto } from './dto/document-center-query.dto';

@ApiTags('core/documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentCenterController {
  constructor(private readonly center: DocumentCenterService) {}

  /** Unified read-only document center: documents (filtered/paginated), category facets, compliance alerts. */
  @Get('center')
  @RequirePermissions(PERMISSIONS.CORE.DOCUMENTS_READ)
  overview(@CurrentUser() user: AuthUser, @Query() query: DocumentCenterQueryDto) {
    return this.center.overview(user.tenantId, query);
  }
}
