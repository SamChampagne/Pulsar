import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AiDraftService } from './ai-draft.service';
import { EmailsService } from './emails.service';
import { MailService } from './mail.service';
import { AiDraftDto, ComposeEmailDto } from './dto/emails.dto';
import { ListEmailsQueryDto } from './dto/list-emails-query.dto';

@ApiTags('core/emails')
@ApiBearerAuth()
@Controller('emails')
export class EmailsController {
  constructor(
    private readonly emailsService: EmailsService,
    private readonly mailService: MailService,
    private readonly aiDraftService: AiDraftService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.EMAIL.READ)
  async list(@CurrentUser() user: AuthUser, @Query() query: ListEmailsQueryDto) {
    return this.emailsService.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.EMAIL.READ)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.emailsService.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EMAIL.SEND)
  async compose(@CurrentUser() user: AuthUser, @Body() dto: ComposeEmailDto) {
    return this.mailService.queue(user.tenantId, {
      toAddresses: dto.to,
      cc: dto.cc,
      subject: dto.subject,
      html: dto.html,
      text: dto.text,
      templateKey: dto.templateKey,
      relatedType: dto.relatedType,
      relatedId: dto.relatedId,
      attachments: dto.attachments,
      createdByUserId: user.id,
    });
  }

  @Post('draft')
  @RequirePermissions(PERMISSIONS.EMAIL.SEND)
  async draft(@CurrentUser() user: AuthUser, @Body() dto: AiDraftDto) {
    return this.aiDraftService.draft(user.tenantId, {
      prompt: dto.prompt,
      context: dto.context,
    });
  }
}
