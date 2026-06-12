import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { StopStatus } from '@pulsar/shared';
import type { Response } from 'express';
import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Public } from '../../../common/decorators/public.decorator';
import { TendersService } from '../tenders/tenders.service';
import { BolService } from '../bol/bol.service';
import { PublicLinksService } from './public-links.service';

class DeclineTenderDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class DriverStopDto {
  @IsEnum(StopStatus)
  status!: StopStatus;
}

class DriverPodDto {
  @IsString()
  shipmentId!: string;

  @IsOptional()
  @IsString()
  signedByName?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class DriverPositionDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

/**
 * Tokenized endpoints for external actors — no JWT, no module/permission guard.
 * The token in the URL *is* the credential; every handler revalidates it.
 */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicLinksController {
  constructor(
    private readonly tenders: TendersService,
    private readonly links: PublicLinksService,
    private readonly bol: BolService,
  ) {}

  // --- Carrier tender response ---------------------------------------------

  @Get('tenders/:token')
  getTender(@Param('token') token: string) {
    return this.tenders.getByToken(token);
  }

  @Post('tenders/:token/accept')
  @HttpCode(200)
  acceptTender(@Param('token') token: string) {
    return this.tenders.respond(token, true);
  }

  @Post('tenders/:token/decline')
  @HttpCode(200)
  declineTender(@Param('token') token: string, @Body() dto: DeclineTenderDto) {
    return this.tenders.respond(token, false, dto.reason);
  }

  // --- Customer tracking ------------------------------------------------------

  @Get('tracking/:token')
  getTracking(@Param('token') token: string) {
    return this.links.getTracking(token);
  }

  // --- Driver page --------------------------------------------------------------

  @Get('driver/:token')
  getDriverView(@Param('token') token: string) {
    return this.links.getDriverView(token);
  }

  @Post('driver/:token/stops/:stopId/status')
  @HttpCode(200)
  driverStop(
    @Param('token') token: string,
    @Param('stopId') stopId: string,
    @Body() dto: DriverStopDto,
  ) {
    return this.links.driverUpdateStop(token, stopId, dto.status);
  }

  @Post('driver/:token/pod')
  driverPod(@Param('token') token: string, @Body() dto: DriverPodDto) {
    return this.links.driverCreatePod(token, dto);
  }

  /** Geolocation ping from the driver page. Deduped server-side (≥60s apart). */
  @Post('driver/:token/position')
  @HttpCode(200)
  driverPosition(@Param('token') token: string, @Body() dto: DriverPositionDto) {
    return this.links.driverRecordPosition(token, dto.latitude, dto.longitude);
  }

  @Post('driver/:token/pod/:shipmentId/photo')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  driverPodPhoto(
    @Param('token') token: string,
    @Param('shipmentId') shipmentId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing "file" field (multipart/form-data)');
    return this.links.driverAttachPodPhoto(token, shipmentId, file);
  }

  /** Stream the latest BOL PDF for this driver's load. Token is the only credential. */
  @Get('driver/:token/bol')
  async driverBol(@Param('token') token: string, @Res() res: Response) {
    const { stream, fileName, mimeType } = await this.bol.driverBol(token);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  }
}
