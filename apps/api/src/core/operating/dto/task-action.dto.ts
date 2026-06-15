import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TaskAssigneeType } from '@pulsar/shared';

export class ResolveTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class AssignTaskDto {
  @ApiProperty({ enum: TaskAssigneeType })
  @IsEnum(TaskAssigneeType)
  assigneeType!: TaskAssigneeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assigneeUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assigneeAgentId?: string;
}
