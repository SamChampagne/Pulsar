import { Body, Controller, Get, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PlatformController } from '../../common/decorators/platform-controller.decorator';
import {
  PlatformEmailConfigService,
  type PlatformActor,
} from '../email/platform-email-config.service';
import { PlatformServicesService } from './platform-services.service';
import { PlatformRuntimeDto, PlatformSmtpDto, ServiceChangeDto } from './dto/platform-services.dto';

// Platform JWT + active operator, not tenant RBAC. Never accepts a tenant JWT or an impersonated user.
@ApiTags('platform')
@ApiBearerAuth()
@PlatformController()
@Controller('platform/services')
export class PlatformServicesController {
  constructor(
    private readonly services: PlatformServicesService,
    private readonly email: PlatformEmailConfigService,
  ) {}
  @Get() overview() {
    return this.services.overview();
  }
  @Get('tenants/:id') detail(@Param('id') id: string) {
    return this.services.detail(id);
  }
  @Put('email') saveGlobal(@Req() req: { user: PlatformActor }, @Body() dto: PlatformSmtpDto) {
    return this.email.save(req.user, dto);
  }
  @Post('email/verify') verifyGlobal(
    @Req() req: { user: PlatformActor },
    @Body() dto: ServiceChangeDto,
  ) {
    return this.services.verifyEmail(req.user, dto);
  }
  @Put('tenants/:id/email') saveEmail(
    @Req() req: { user: PlatformActor },
    @Param('id') id: string,
    @Body() dto: PlatformSmtpDto,
  ) {
    return this.services.saveEmail(req.user, id, dto);
  }
  @Post('tenants/:id/email/verify') verifyEmail(
    @Req() req: { user: PlatformActor },
    @Param('id') id: string,
    @Body() dto: ServiceChangeDto,
  ) {
    return this.services.verifyEmail(req.user, dto, id);
  }
  @Put('tenants/:id/runtime') saveRuntime(
    @Req() req: { user: PlatformActor },
    @Param('id') id: string,
    @Body() dto: PlatformRuntimeDto,
  ) {
    return this.services.saveRuntime(req.user, id, dto);
  }
  @Post('tenants/:id/runtime/verify') verifyRuntime(
    @Req() req: { user: PlatformActor },
    @Param('id') id: string,
    @Body() dto: ServiceChangeDto,
  ) {
    return this.services.testRuntime(req.user, id, dto);
  }
  @Post('tenants/:id/runtime/connect')
  async connect(
    @Req() req: { user: PlatformActor },
    @Param('id') id: string,
    @Body() dto: ServiceChangeDto,
    @Res() res: Response,
  ) {
    await this.services.authorizeRuntimeAction(req.user, id, dto, 'OAUTH_CONNECT');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const send = (event: string, data: unknown) => {
      if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      for await (const event of this.services.connectRuntime(id, abort.signal)) {
        if (event.type === 'text') send('text', { text: event.text });
        else if (event.type === 'end') send('end', {});
        else
          send('error', {
            message: 'Connexion interrompue ou refusée. Vérifiez le runner et le fournisseur.',
          });
      }
    } catch {
      send('error', {
        message: 'Connexion indisponible. Vérifiez le diagnostic de cette entreprise.',
      });
    } finally {
      abort.abort();
      res.end();
    }
  }
}
