import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SitesService } from './sites.service';
import { CreateLandingPageDto, LandingPageListQueryDto, UpdateLandingPageDto } from './dto/landing-page.dto';

@ApiTags('sites')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.SITES)
@Controller('sites/pages')
export class PagesController {
  constructor(private readonly service: SitesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SITES.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: LandingPageListQueryDto) {
    return this.service.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SITES.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SITES.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateLandingPageDto) {
    return this.service.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SITES.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateLandingPageDto) {
    return this.service.update(user.tenantId, user.id, id, dto);
  }

  @Post(':id/publish')
  @RequirePermissions(PERMISSIONS.SITES.MANAGE)
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.publish(user.tenantId, user.id, id);
  }

  @Post(':id/unpublish')
  @RequirePermissions(PERMISSIONS.SITES.MANAGE)
  unpublish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.unpublish(user.tenantId, user.id, id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.SITES.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, user.id, id);
  }

  @Get(':id/submissions')
  @RequirePermissions(PERMISSIONS.SITES.READ)
  listSubmissions(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() query: LandingPageListQueryDto) {
    return this.service.listSubmissions(user.tenantId, id, query);
  }
}
