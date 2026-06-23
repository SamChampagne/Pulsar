import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ListsService } from './lists.service';
import {
  AddCompanyContactsDto,
  AddMemberDto,
  CreateListDto,
  ListListQueryDto,
  UpdateListDto,
} from './dto/list.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListListQueryDto) {
    return this.lists.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lists.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListDto) {
    return this.lists.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateListDto) {
    return this.lists.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lists.remove(user.tenantId, id);
  }

  // ── Member sub-routes ─────────────────────────────────────────────────────

  @Get(':id/members')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  members(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.lists.members(user.tenantId, id);
  }

  @Post(':id/members')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  addMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.lists.addMember(user.tenantId, id, dto);
  }

  @Delete(':id/members/:contactId')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ) {
    return this.lists.removeMember(user.tenantId, id, contactId);
  }

  @Post(':id/add-company-contacts')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  addCompanyContacts(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddCompanyContactsDto,
  ) {
    return this.lists.addCompanyContacts(user.tenantId, id, dto);
  }
}
