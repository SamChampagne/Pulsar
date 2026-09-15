import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CommunicationConsent, CrmSequenceMode, CrmSequenceTrigger } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

class SequenceStepDto {
  @IsInt() @Min(0) @Max(43200) delayMinutes!: number;
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/^[^\r\n]+$/) subject!: string;
  @IsString() @MinLength(1) @MaxLength(10000) body!: string;
}
export class SaveSequenceDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsBoolean() enabled!: boolean;
  @IsEnum(CrmSequenceMode) mode!: CrmSequenceMode;
  @IsEnum(CrmSequenceTrigger) trigger!: CrmSequenceTrigger;
  @IsOptional() @IsString() @MinLength(1) pipelineStageId?: string;
  @IsOptional() @IsString() @MinLength(1) agentId?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => SequenceStepDto)
  steps!: SequenceStepDto[];
}
export class EnrollSequenceDto {
  @IsString() @MinLength(1) contactId!: string;
}
export class SequenceRunsQueryDto extends ListQueryDto {
  @IsOptional() @IsString() contactId?: string;
  @IsOptional() @IsString() sequenceId?: string;
  @IsOptional() @IsString() dealId?: string;
}
export class EmailPreferenceDto {
  @IsEnum(CommunicationConsent) consent!: CommunicationConsent;
  @IsString() @MinLength(3) @MaxLength(300) source!: string;
}
export class UnsubscribeSequenceDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{32}$/) token!: string;
}
