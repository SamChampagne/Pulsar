import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CampaignsService } from './campaigns.service';
import { CampaignListQueryDto, CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: CampaignListQueryDto) {
    return this.campaigns.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.campaigns.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.remove(user.tenantId, id);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE, PERMISSIONS.EMAIL.SEND)
  send(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.send(user.tenantId, id, user.id);
  }

  @Get(':id/stats')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  stats(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.campaigns.stats(user.tenantId, id);
  }
}
