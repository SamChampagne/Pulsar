import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AuthUser, CommunicationChannel, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CommunicationContextDto,
  CommunicationPreferenceDto,
  CommunicationRecipientDto,
  CommunicationSendDto,
  CommunicationTemplateDto,
} from './communications.dto';
import { CommunicationsService } from './communications.service';
class ChannelDto {
  @IsEnum(CommunicationChannel) channel!: CommunicationChannel;
}

/** Core facade: closed source catalogue checks its own module + business rights on every request. */
@ApiTags('core/communications')
@ApiBearerAuth()
@Controller('communications')
@RequirePermissions(PERMISSIONS.CORE.COMMUNICATIONS_READ)
export class CommunicationsController {
  constructor(private readonly service: CommunicationsService) {}
  @Get('context') context(@CurrentUser() actor: AuthUser, @Query() dto: CommunicationContextDto) {
    return this.service.context(actor, dto);
  }
  @Get('preference') preference(
    @CurrentUser() actor: AuthUser,
    @Query() dto: CommunicationRecipientDto,
  ) {
    return this.service.getPreference(actor, dto);
  }
  @Put('preference')
  @RequirePermissions(PERMISSIONS.CORE.COMMUNICATIONS_READ, PERMISSIONS.CORE.COMMUNICATIONS_MANAGE)
  savePreference(@CurrentUser() actor: AuthUser, @Body() dto: CommunicationPreferenceDto) {
    return this.service.setPreference(actor, dto);
  }
  @Post('messages')
  @HttpCode(200)
  send(@CurrentUser() actor: AuthUser, @Body() dto: CommunicationSendDto) {
    return this.service.send(actor, dto);
  }
  @Get('templates') templates(@CurrentUser() actor: AuthUser, @Query() dto: ChannelDto) {
    return this.service.templates(actor, dto.channel);
  }
  @Post('templates')
  @RequirePermissions(PERMISSIONS.CORE.COMMUNICATIONS_READ, PERMISSIONS.CORE.COMMUNICATIONS_MANAGE)
  createTemplate(@CurrentUser() actor: AuthUser, @Body() dto: CommunicationTemplateDto) {
    return this.service.saveTemplate(actor, null, dto);
  }
  @Put('templates/:id')
  @RequirePermissions(PERMISSIONS.CORE.COMMUNICATIONS_READ, PERMISSIONS.CORE.COMMUNICATIONS_MANAGE)
  updateTemplate(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: CommunicationTemplateDto,
  ) {
    return this.service.saveTemplate(actor, id, dto);
  }
}
