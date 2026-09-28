import { IsIn, IsOptional } from 'class-validator';
import {
  DIRECTORY_IMPACT_SOURCES,
  type DirectoryImpactSource,
  type DirectoryImpactScope,
} from '@pulsar/shared';
import { ListQueryDto } from '../../common/dto/list-query.dto';
import { PickType } from '@nestjs/swagger';
export class DirectoryImpactQueryDto extends PickType(ListQueryDto, ['page', 'pageSize'] as const) {
  @IsOptional() @IsIn(DIRECTORY_IMPACT_SOURCES) source?: DirectoryImpactSource;
  @IsOptional() @IsIn(['DRAFT', 'FROZEN']) scope?: DirectoryImpactScope;
}
