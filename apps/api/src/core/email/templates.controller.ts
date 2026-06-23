import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EmailTemplatesService } from './email-templates.service';
import { CreateEmailTemplateDto, UpdateEmailTemplateDto } from './dto/email-templates.dto';

@ApiTags('core/emails')
@ApiBearerAuth()
@Controller('emails/templates')
export class TemplatesController {
  constructor(private readonly templates: EmailTemplatesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  async list(@CurrentUser() user: AuthUser) {
    return this.templates.list(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateEmailTemplateDto) {
    return this.templates.create(user.tenantId, dto);
  }

  @Put(':id')
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return this.templates.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.templates.remove(user.tenantId, id);
  }
}
