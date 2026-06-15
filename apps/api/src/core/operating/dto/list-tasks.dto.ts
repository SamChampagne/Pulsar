import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OperationalTaskStatus, TaskAssigneeType } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class ListTasksDto extends ListQueryDto {
  @ApiPropertyOptional({ enum: OperationalTaskStatus })
  @IsOptional()
  @IsEnum(OperationalTaskStatus)
  status?: OperationalTaskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: TaskAssigneeType })
  @IsOptional()
  @IsEnum(TaskAssigneeType)
  assigneeType?: TaskAssigneeType;
}
