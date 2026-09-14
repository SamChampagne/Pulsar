import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EmailConfigService } from './email-config.service';
import { SendTestEmailDto, UpsertEmailConfigDto } from './dto/email-config.dto';

@ApiTags('core/email-config')
@ApiBearerAuth()
@Controller('email-config')
export class EmailConfigController {
  constructor(private readonly emailConfig: EmailConfigService) {}

  @Get('connection')
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  connection(@CurrentUser() user: AuthUser) {
    return this.emailConfig.connectionStatus(user.tenantId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  async get(@CurrentUser() user: AuthUser) {
    return this.emailConfig.get(user.tenantId);
  }

  @Put()
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  async upsert(@CurrentUser() user: AuthUser, @Body() dto: UpsertEmailConfigDto) {
    return this.emailConfig.upsert(user.tenantId, dto, user.id);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  async test(@CurrentUser() user: AuthUser, @Body() dto: SendTestEmailDto) {
    return this.emailConfig.sendTest(user.tenantId, dto.to);
  }

  @Post('test-inbound')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.EMAIL.MANAGE)
  @ApiOperation({ summary: 'Test the tenant IMAP inbound connection' })
  testInbound(@CurrentUser() user: AuthUser) {
    return this.emailConfig.testInbound(user.tenantId);
  }
}
