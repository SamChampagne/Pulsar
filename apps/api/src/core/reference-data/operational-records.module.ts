import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { CustomersService } from '../../modules/transportation/customers/customers.service';
import { CarriersService } from '../../modules/transportation/carriers/carriers.service';
import { DriversService } from '../../modules/transportation/drivers/drivers.service';
import { VehiclesService } from '../../modules/transportation/vehicles/vehicles.service';
import { TrailersService } from '../../modules/transportation/trailers/trailers.service';

// One set of existing writers/tables, independent from the TMS HTTP surface and workflows.
const records = [
  CustomersService,
  CarriersService,
  DriversService,
  VehiclesService,
  TrailersService,
];
@Module({ imports: [CustomFieldsModule], providers: records, exports: records })
export class OperationalRecordsModule {}
