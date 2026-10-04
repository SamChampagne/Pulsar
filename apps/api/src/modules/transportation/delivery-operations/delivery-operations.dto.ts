import { IsIn, IsOptional, MaxLength } from 'class-validator';
import { DELIVERY_OPERATION_FILTERS, type DeliveryOperationFilter } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class DeliveryOperationsQuery extends ListQueryDto {
  @IsOptional() @IsIn(DELIVERY_OPERATION_FILTERS) filter?: DeliveryOperationFilter;
  @IsOptional() @MaxLength(120) declare search?: string;
}
