import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  Param,
  Req,
  RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser, E164_PATTERN, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SmsService } from './sms.service';
import { SmsWebhooksService } from './sms-webhooks.service';
import { Public } from '../../common/decorators/public.decorator';

export class SmsConfigDto {
  @ValidateIf((_, value) => value !== null) @IsDateString() expectedUpdatedAt!: string | null;
  @IsString() @Matches(E164_PATTERN) fromNumber!: string;
  @IsUUID() messagingProfileId!: string;
  @IsBoolean() live!: boolean;
  @IsBoolean() active!: boolean;
  @IsOptional() @Equals(true) confirmLive?: boolean;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9+/]{43}=$/) webhookPublicKey?: string;
  @IsOptional() @IsString() @MaxLength(255) webhookOrigin?: string;
  @IsInt() @Min(1) @Max(500) dailyLimit!: number;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(512) @Matches(/^\S+$/) apiKey?: string;
}
export class SendSmsDto {
  @IsUUID() operationKey!: string;
  @IsDateString() expectedUpdatedAt!: string;
  @IsString() @Matches(E164_PATTERN) toNumber!: string;
  @IsString() @MaxLength(1600) @Matches(/\S/) text!: string;
  @Equals(true) confirmed!: boolean;
}
export class SmsListDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page: number = 1;
}

@ApiTags('core/sms')
@ApiBearerAuth()
@Controller('sms')
export class SmsController {
  constructor(
    private readonly sms: SmsService,
    private readonly webhooks: SmsWebhooksService,
  ) {}
  @Get('inbox')
  @RequirePermissions(PERMISSIONS.SMS.READ)
  inbox(@CurrentUser() user: AuthUser, @Query() query: SmsListDto) {
    return this.webhooks.inbox(user.tenantId, query.page);
  }
  @Get('suppressions')
  @RequirePermissions(PERMISSIONS.SMS.READ)
  suppressions(@CurrentUser() user: AuthUser, @Query() query: SmsListDto) {
    return this.webhooks.suppressions(user.tenantId, query.page);
  }
  @Get('connection')
  @RequirePermissions(PERMISSIONS.SMS.READ)
  connection(@CurrentUser() user: AuthUser) {
    return this.sms.connection(user.tenantId);
  }
  @Put('config')
  @RequirePermissions(PERMISSIONS.SMS.READ, PERMISSIONS.SMS.MANAGE)
  configure(@CurrentUser() user: AuthUser, @Body() dto: SmsConfigDto) {
    return this.sms.configure(user, dto);
  }
  @Get('messages')
  @RequirePermissions(PERMISSIONS.SMS.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: SmsListDto) {
    return this.sms.list(user.tenantId, query.page);
  }
  @Post('messages')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SMS.READ, PERMISSIONS.SMS.SEND)
  send(@CurrentUser() user: AuthUser, @Body() dto: SendSmsDto) {
    return this.sms.send(user, dto);
  }
}

/** Public by necessity: authentication is the Ed25519 signature, never a body tenantId. */
@Controller('sms/webhooks')
export class SmsWebhookController {
  constructor(private readonly webhooks: SmsWebhooksService) {}
  @Post(':configId')
  @Public()
  @HttpCode(200)
  receive(@Param('configId') configId: string, @Req() request: RawBodyRequest<Request>) {
    return this.webhooks.receive(
      configId,
      request.rawBody,
      request.get('telnyx-timestamp') ?? '',
      request.get('telnyx-signature-ed25519') ?? '',
    );
  }
}
