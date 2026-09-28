import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CommunicationChannel } from '@pulsar/shared';

export class CommunicationContextDto {
  @IsString() @MaxLength(100) access!: string;
  @IsString() @MaxLength(100) @Matches(/^[a-zA-Z0-9_-]+$/) entityId!: string;
  @IsEnum(CommunicationChannel) channel!: CommunicationChannel;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page: number = 1;
}
export class CommunicationRecipientDto extends CommunicationContextDto {
  @IsString() @MaxLength(254) recipient!: string;
}
export class CommunicationPreferenceDto extends CommunicationRecipientDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsBoolean() allowed!: boolean;
  @IsString() @Matches(/\S/) @MaxLength(500) evidence!: string;
  @IsDateString() observedAt!: string;
  @Equals(true) confirmed!: boolean;
}
export class CommunicationSendDto extends CommunicationRecipientDto {
  @IsUUID() operationKey!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
  @ValidateIf((_, value) => value !== null) @IsDateString() configVersion!: string | null;
  @IsInt() @Min(1) preferenceVersion!: number;
  @IsOptional() @IsString() @MaxLength(200) @Matches(/^[^\r\n]*$/) subject?: string;
  @IsString() @MaxLength(10000) @Matches(/\S/) text!: string;
  @Equals(true) confirmed!: boolean;
}
export class CommunicationTemplateDto {
  @IsEnum(CommunicationChannel) channel!: CommunicationChannel;
  @IsString() @MaxLength(120) @Matches(/\S/) name!: string;
  @IsOptional() @IsString() @MaxLength(200) @Matches(/^[^\r\n]*$/) subject?: string;
  @IsString() @MaxLength(10000) @Matches(/\S/) text!: string;
  @IsBoolean() active!: boolean;
  @ValidateIf((_, value) => value !== null) @IsDateString() expectedUpdatedAt!: string | null;
}
