import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ArrayMaxSize,
  ArrayMinSize,
  ValidateIf,
} from 'class-validator';
import { QualityInspectionStatus, QualityNonconformityStatus } from '@pulsar/shared';
import { VersionDto } from '../business/business.dto';
import { ListQueryDto } from '../../common/dto/list-query.dto';
const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
export class PlanBodyDto {
  @IsString() @Trim() @Length(1, 200) name!: string;
  @IsString() @Trim() @Length(0, 4000) instructions!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) criteria!: unknown[];
  @IsBoolean() active!: boolean;
}
export class CreatePlanDto extends PlanBodyDto {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{0,39}$/) code!: string;
}
export class UpdatePlanDto extends VersionDto {
  @IsString() @Trim() @Length(1, 200) name!: string;
  @IsString() @Trim() @Length(0, 4000) instructions!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) criteria!: unknown[];
  @IsBoolean() active!: boolean;
}
export class QualityQueryDto extends ListQueryDto {
  @IsOptional() @IsIn(['mine', 'unassigned']) assignment?: string;
  @IsOptional() @IsIn(['true']) overdue?: string;
  @IsOptional() @IsIn(['true', 'false']) active?: string;
  @IsOptional() @IsEnum(QualityInspectionStatus) status?: QualityInspectionStatus;
  @IsOptional() @IsEnum(QualityNonconformityStatus) ncStatus?: QualityNonconformityStatus;
  @IsOptional() @IsIn(['MANUAL', 'RECEIPT', 'MANUFACTURING', 'SUPPORT']) kind?: string;
}
export class CreateInspectionDto {
  @IsString() @Length(1, 100) planId!: string;
  @IsString() @Trim() @Length(1, 200) title!: string;
  @IsIn(['MANUAL', 'RECEIPT', 'MANUFACTURING', 'SUPPORT']) sourceKind!: string;
  @IsOptional() @IsString() @Length(1, 100) sourceId?: string;
  @IsUUID('4') operationKey!: string;
}
export class ResultsDto extends VersionDto {
  @IsArray() @ArrayMaxSize(30) results!: unknown[];
}
export class InspectionTransitionDto extends VersionDto {
  @IsEnum(QualityInspectionStatus) status!: QualityInspectionStatus;
  @IsString() @Trim() @Length(1, 2000) note!: string;
}
export class NonconformityUpdateDto extends VersionDto {
  @IsString() @Trim() @Length(0, 4000) rootCause!: string;
  @IsString() @Trim() @Length(0, 4000) correctiveAction!: string;
}
export class NonconformityTransitionDto extends VersionDto {
  @IsEnum(QualityNonconformityStatus) status!: QualityNonconformityStatus;
  @IsString() @Trim() @Length(1, 2000) note!: string;
}
export class QualityAssignmentDto extends VersionDto {
  @ValidateIf((_o, v) => v !== null) @IsString() @Length(1, 100) assigneeUserId!: string | null;
  @ValidateIf((_o, v) => v !== null) @IsString() @Length(10, 10) dueDate!: string | null;
}
export class QualityEvidenceDto extends VersionDto {
  @IsUUID('4') operationKey!: string;
  @IsString() @Trim() @Length(1, 500) caption!: string;
}
