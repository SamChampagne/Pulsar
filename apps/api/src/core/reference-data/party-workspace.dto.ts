import { IsIn, IsOptional, IsString, MaxLength, Max, Min, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { PARTY_WORKSPACE_SOURCES, type PartyWorkspaceSource } from '@pulsar/shared';
import { ListQueryDto } from '../../common/dto/list-query.dto';

export class PartyWorkspaceQueryDto extends ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  declare page?: number;

  @IsOptional()
  @IsIn(PARTY_WORKSPACE_SOURCES.map((s) => s.key))
  source?: PartyWorkspaceSource;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  declare search?: string;
}
