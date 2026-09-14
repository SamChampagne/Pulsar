import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformController } from '../../common/decorators/platform-controller.decorator';
import { PlatformOperationsService } from './platform-operations.service';

// Platform JWT is the authorization boundary; tenant permission decorators do not apply.
@ApiTags('platform')
@ApiBearerAuth()
@PlatformController()
@Controller('platform/operations')
export class PlatformOperationsController {
  constructor(private readonly operations: PlatformOperationsService) {}
  @Get()
  overview() {
    return this.operations.overview();
  }
  @Get('tenants/:id')
  tenant(@Param('id') id: string) {
    return this.operations.tenant(id);
  }
}
