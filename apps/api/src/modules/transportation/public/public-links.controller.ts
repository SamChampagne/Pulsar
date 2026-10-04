import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { StopStatus } from '@pulsar/shared';
import type { Response } from 'express';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
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
  @MaxLength(64)
  shipmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  signedByName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
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

class DriverReportExceptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  shipmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  stopId?: string;

  @IsIn(['DAMAGE', 'DELAY', 'REFUSED', 'OTHER'])
  @IsString()
  kind!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note!: string;
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
  @UseGuards(ThrottlerGuard)
  @Header('Cache-Control', 'private, no-store')
  getDriverView(@Param('token') token: string) {
    return this.links.getDriverView(token);
  }

  @Post('driver/:token/stops/:stopId/status')
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  driverStop(
    @Param('token') token: string,
    @Param('stopId') stopId: string,
    @Body() dto: DriverStopDto,
  ) {
    return this.links.driverUpdateStop(token, stopId, dto.status);
  }

  @Post('driver/:token/pod')
  @UseGuards(ThrottlerGuard)
  driverPod(@Param('token') token: string, @Body() dto: DriverPodDto) {
    return this.links.driverCreatePod(token, dto);
  }

  /** Geolocation ping from the driver page. Deduped server-side (≥60s apart). */
  @Post('driver/:token/position')
  @UseGuards(ThrottlerGuard) // anonymous input: 20 req/min/IP (app-wide ThrottlerModule config)
  @HttpCode(200)
  driverPosition(@Param('token') token: string, @Body() dto: DriverPositionDto) {
    return this.links.driverRecordPosition(token, dto.latitude, dto.longitude);
  }

  @Post('driver/:token/pod/:shipmentId/photo')
  @UseGuards(ThrottlerGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  driverPodPhoto(
    @Param('token') token: string,
    @Param('shipmentId') shipmentId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing "file" field (multipart/form-data)');
    return this.links.driverAttachPodPhoto(token, shipmentId, file);
  }

  /** Legacy route retained, but unqualified BOL PDFs are denied by the capability service. */
  @Get('driver/:token/bol')
  @UseGuards(ThrottlerGuard)
  async driverBol(@Param('token') token: string, @Res() res: Response) {
    const { stream, fileName, mimeType } = await this.bol.driverBol(token);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/["\r\n]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  }

  /** Attach a PNG signature image to a shipment's proof-of-delivery. */
  @Post('driver/:token/pod/:shipmentId/signature')
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 512 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  driverPodSignature(
    @Param('token') token: string,
    @Param('shipmentId') shipmentId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Missing "file" field (multipart/form-data)');
    return this.links.driverAttachSignature(token, shipmentId, file);
  }

  /** Report a driver exception (damage, delay, refusal, other) for audit and workbench task creation. */
  @Post('driver/:token/exception')
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  driverException(@Param('token') token: string, @Body() dto: DriverReportExceptionDto) {
    return this.links.driverReportException(token, dto);
  }
}
