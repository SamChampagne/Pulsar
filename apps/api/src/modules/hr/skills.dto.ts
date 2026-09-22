import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { HrSkillKind } from '@pulsar/shared';
import { VersionDto } from '../business/business.dto';
import { ListQueryDto } from '../../common/dto/list-query.dto';
const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
export class SkillQueryDto extends ListQueryDto {
  @IsOptional() @IsString() @Length(1, 100) employeeId?: string;
}
export class CreateSkillDto {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{0,39}$/) code!: string;
  @IsString() @Trim() @Length(1, 150) name!: string;
  @IsEnum(HrSkillKind) kind!: HrSkillKind;
}
export class UpdateSkillDto extends VersionDto {
  @IsString() @Trim() @Length(1, 150) name!: string;
  @IsBoolean() active!: boolean;
}
export class CreateQualificationDto {
  @IsString() @Length(1, 100) employeeId!: string;
  @IsString() @Length(1, 100) skillId!: string;
  @IsString() @Length(10, 10) validFrom!: string;
  @ValidateIf((_o, v) => v !== null) @IsString() @Length(10, 10) expiresOn!: string | null;
  @IsString() @Trim() @Length(1, 500) reference!: string;
  @IsUUID('4') operationKey!: string;
}
export class RevokeQualificationDto extends VersionDto {
  @IsString() @Trim() @Length(1, 1000) reason!: string;
}
export class RequirementsDto extends VersionDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  skillIds!: string[];
}
export class QualificationCheckDto {
  @IsString() @Length(1, 100) employeeId!: string;
  @IsString() @Length(1, 100) workCenterId!: string;
  @IsString() @Length(10, 10) date!: string;
}
