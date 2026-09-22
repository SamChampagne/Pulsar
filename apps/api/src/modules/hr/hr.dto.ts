import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { HrLeaveKind, HrLeaveStatus } from '@pulsar/shared';
import { IntersectionType } from '@nestjs/swagger';
import { VersionDto } from '../business/business.dto';
import { ListQueryDto } from '../../common/dto/list-query.dto';
const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
export class HrQueryDto extends ListQueryDto {
  @IsOptional() @IsIn(['true', 'false']) active?: string;
  @IsOptional() @IsEnum(HrLeaveStatus) status?: HrLeaveStatus;
  @IsOptional() @IsString() @Length(1, 100) employeeId?: string;
  @IsOptional() @IsString() @Length(1, 100) teamId?: string;
}
class TeamBody {
  @IsString() @Trim() @Length(1, 150) name!: string;
  @IsBoolean() active!: boolean;
}
export class CreateTeamDto extends TeamBody {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{0,39}$/) code!: string;
}
export class UpdateTeamDto extends IntersectionType(TeamBody, VersionDto) {}
class EmployeeBody {
  @IsString() @Trim() @Length(1, 100) firstName!: string;
  @IsString() @Trim() @Length(1, 100) lastName!: string;
  @IsString() @Trim() @Length(0, 150) jobTitle!: string;
  @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 100) teamId!: string | null;
  @IsBoolean() active!: boolean;
}
export class CreateEmployeeDto extends EmployeeBody {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{0,39}$/) code!: string;
  @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 100) userId!: string | null;
}
export class UpdateEmployeeDto extends IntersectionType(EmployeeBody, VersionDto) {}
class LeaveBody {
  @IsEnum(HrLeaveKind) kind!: HrLeaveKind;
  @IsString() @Length(10, 10) startDate!: string;
  @IsString() @Length(10, 10) endDate!: string;
  @IsString() @Trim() @Length(0, 1000) note!: string;
}
export class CreateLeaveDto extends LeaveBody {
  @IsString() @Length(1, 100) employeeId!: string;
  @IsUUID('4') operationKey!: string;
}
export class UpdateLeaveDto extends IntersectionType(LeaveBody, VersionDto) {}
export class LeaveTransitionDto extends VersionDto {
  @IsEnum(HrLeaveStatus) status!: HrLeaveStatus;
  @IsString() @Trim() @Length(1, 1000) note!: string;
}
