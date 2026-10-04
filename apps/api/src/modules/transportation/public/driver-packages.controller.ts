import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator';
import { DriverPackagesService } from './driver-packages.service';
import { DriverPackageExceptionDto, DriverPackageTransitionDto } from './driver-packages.dto';

/** No JWT: every read, write and replay rechecks the live module-scoped capability. */
@Public()
@Controller('public/driver/:token/packages')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class DriverPackagesController {
  constructor(private readonly service: DriverPackagesService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  list(@Param('token') token: string) {
    return this.service.list(token);
  }

  @Post(':ref/transition')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  transition(
    @Param('token') token: string,
    @Param('ref') ref: string,
    @Body() dto: DriverPackageTransitionDto,
  ) {
    return this.service.transition(token, ref, dto);
  }

  @Post(':ref/exception')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  exception(
    @Param('token') token: string,
    @Param('ref') ref: string,
    @Body() dto: DriverPackageExceptionDto,
  ) {
    return this.service.exception(token, ref, dto);
  }
}
