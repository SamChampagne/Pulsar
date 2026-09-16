import { Module } from '@nestjs/common';
import { RoutingModule } from '../routing/routing.module';
import { CoreLocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [RoutingModule],
  controllers: [CoreLocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class CoreLocationsModule {}
