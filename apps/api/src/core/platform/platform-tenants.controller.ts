import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { PlatformGuard } from './platform.guard';
import { PlatformTenantsService } from './platform-tenants.service';

interface PlatformRequest {
  user: { id: string; email: string };
}

/**
 * Cross-tenant operations. @Public() skips the global tenant JwtAuthGuard;
 * PlatformGuard then enforces a *platform* token (and live ACTIVE status).
 */
@ApiTags('platform')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tenants.get(id);
  }

  @Post()
  create(@Req() req: PlatformRequest, @Body() dto: CreatePlatformTenantDto) {
    return this.tenants.create(req.user.email, dto);
  }

  @Post(':id/suspend')
  suspend(@Req() req: PlatformRequest, @Param('id') id: string) {
    return this.tenants.suspend(req.user.email, id);
  }

  @Post(':id/reactivate')
  reactivate(@Req() req: PlatformRequest, @Param('id') id: string) {
    return this.tenants.reactivate(req.user.email, id);
  }
}
