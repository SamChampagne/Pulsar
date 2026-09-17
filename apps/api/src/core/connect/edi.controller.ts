import { BadRequestException, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EdiService } from './edi.service';

/**
 * Staff/partner EDI intake. Two equivalent shapes, so a partner can post the
 * interchange exactly as its translator produces it:
 *
 *   POST /connect/edi/inbound        Content-Type: text/plain
 *   X-Integration-Key: edi-acme      <raw X12 interchange>
 *
 *   POST /connect/edi/inbound        Content-Type: application/json
 *   { "integrationKey": "edi-acme", "content": "ISA*00*..." }
 *
 * The text form is parsed by `rawTextBody` (ConnectModule middleware) since Nest
 * registers no text body parser.
 *
 * An unauthenticated partner uses the public receiver instead
 * (`POST /public/hooks/:inboundToken`, integration `config.format = "x12"`),
 * which funnels into the very same service.
 */
@ApiTags('core/connect')
@ApiBearerAuth()
@Controller('connect/edi')
export class EdiController {
  constructor(private readonly edi: EdiService) {}

  /**
   * 202 — the interchange was accepted for processing. `status` says whether the
   * business write succeeded (`IMPORTED`) or the tender was declined (`FAILED`),
   * and `ack` carries the 990 to hand back to the partner in both cases.
   */
  @Post('inbound')
  @HttpCode(202)
  @ApiConsumes('text/plain', 'application/json')
  @ApiBody({
    description: 'Raw X12 interchange, or { integrationKey, content }.',
    schema: { type: 'string' },
  })
  @RequirePermissions(PERMISSIONS.CORE.CONNECT_MANAGE)
  inbound(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Headers('x-integration-key') headerKey?: string,
  ) {
    const { integrationKey, content } = readEdiBody(body, headerKey);
    return this.edi.receive(user.tenantId, { integrationKey, content });
  }
}

/** Accepts the text form (+ `X-Integration-Key`) and the JSON envelope alike. */
export function readEdiBody(
  body: unknown,
  headerKey?: string,
): { integrationKey?: string; content: string } {
  const key = headerKey?.trim() || undefined;
  if (typeof body === 'string') {
    return { ...(key ? { integrationKey: key } : {}), content: body };
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content : '';
    const bodyKey = typeof record.integrationKey === 'string' ? record.integrationKey.trim() : '';
    if (!content) {
      throw new BadRequestException(
        'Send the interchange as a text/plain body, or as { integrationKey, content }',
      );
    }
    return { ...(bodyKey || key ? { integrationKey: bodyKey || key } : {}), content };
  }
  throw new BadRequestException(
    'Send the interchange as a text/plain body, or as { integrationKey, content }',
  );
}
