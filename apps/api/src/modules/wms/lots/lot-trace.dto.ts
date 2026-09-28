import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import type { LotTraceDirection } from '@pulsar/shared';
export class LotTraceQueryDto {
  @IsIn(['downstream', 'upstream']) direction: LotTraceDirection = 'downstream';
  @Type(() => Number) @IsInt() @Min(1) @Max(4) depth: number = 3;
}
export class LotTraceDossiersDto extends ListQueryDto {
  @IsIn(['picks', 'receipts', 'services']) kind: 'picks' | 'receipts' | 'services' = 'picks';
}
