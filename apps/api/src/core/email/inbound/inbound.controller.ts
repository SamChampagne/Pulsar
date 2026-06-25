import { Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { InboundIngestService } from './inbound-ingest.service';
import { SimulateInboundDto } from '../dto/simulate-inbound.dto';

@ApiTags('emails')
@ApiBearerAuth()
@Controller('emails')
export class InboundController {
  constructor(private readonly ingest: InboundIngestService) {}

  /** Dev/CI only: inject a synthetic inbound email to exercise threading without IMAP. */
  @Post('_simulate-inbound')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  @ApiOperation({ summary: '[dev] Simulate an inbound email' })
  simulate(@CurrentUser() user: AuthUser, @Body() dto: SimulateInboundDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('simulate-inbound is disabled in production');
    }
    return this.ingest.ingest(user.tenantId, {
      from: dto.from,
      fromName: dto.fromName,
      to: dto.to ?? [],
      subject: dto.subject,
      html: dto.html ?? `<p>${dto.text ?? ''}</p>`,
      text: dto.text,
      messageId: dto.messageId,
      inReplyTo: dto.inReplyTo,
      references: dto.references ?? [],
      receivedAt: new Date(),
      attachments: [],
    });
  }
}
