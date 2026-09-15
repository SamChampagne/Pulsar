import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
export class FleetWorkspaceQuery extends ListQueryDto {
  @IsOptional() @IsIn(['vehicle', 'trailer']) kind: 'vehicle' | 'trailer' = 'vehicle';
  @IsOptional() @IsIn(['internal', 'all']) ownership: 'internal' | 'all' = 'internal';
  @IsOptional() @IsIn(['AVAILABLE', 'IN_SERVICE', 'MAINTENANCE', 'RETIRED']) status?: string;
  @IsOptional() @IsString() @MaxLength(80) search: string | undefined = undefined;
}
export class FleetAgendaQuery extends FleetWorkspaceQuery {
  @IsOptional() @IsIn(['dated', 'overdue', 'undated', 'history']) bucket:
    | 'dated'
    | 'overdue'
    | 'undated'
    | 'history' = 'dated';
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
}
