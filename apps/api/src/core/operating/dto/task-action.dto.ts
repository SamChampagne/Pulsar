import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { TaskAssigneeType } from '@pulsar/shared';

export class ResolveTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class AddNoteDto {
  @ApiProperty({ description: 'Note text to append to the task.' })
  @IsString()
  @IsNotEmpty()
  text!: string;
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
