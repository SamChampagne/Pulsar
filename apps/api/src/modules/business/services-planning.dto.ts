import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VersionDto } from './business.dto';
export class PlanningQueryDto {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @Type(() => Number) @IsIn([1, 7]) days?: number;
  @IsOptional() @IsString() @Length(1, 100) userId?: string;
  @IsOptional() @IsString() @Length(1, 100) teamId?: string;
}
export class ScheduleServiceJobDto extends VersionDto {
  @IsString() @Length(1, 100) assigneeUserId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) localStart!: string;
  @IsInt() @Min(1) @Max(10080) plannedMinutes!: number;
  @IsOptional() @IsBoolean() acknowledgeUnknown?: boolean;
}
export class ServiceRequirementsDto extends VersionDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  skillIds!: string[];
  @IsOptional() @IsString() @Length(1, 100) workCenterId?: string | null;
}
