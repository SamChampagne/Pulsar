import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ContactsService } from './contacts.service';
import { ContactListQueryDto, CreateContactDto, UpdateContactDto } from './dto/contact.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ContactListQueryDto) {
    return this.contacts.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contacts.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateContactDto) {
    return this.contacts.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contacts.update(user.tenantId, user.id, id, dto);
  }
}
