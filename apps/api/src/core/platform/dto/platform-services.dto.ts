import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { RUNTIME_PROVIDERS } from '@pulsar/shared';

export class ServiceChangeDto {
  @ValidateIf((_, value) => value !== null) @IsDateString() expectedUpdatedAt!: string | null;
  @Equals(true) confirmed!: boolean;
}
export class PlatformSmtpDto extends ServiceChangeDto {
  @IsIn(['ENVIRONMENT', 'SIMULATION', 'SMTP']) mode!: 'ENVIRONMENT' | 'SIMULATION' | 'SMTP';
  @IsOptional() @IsString() @MaxLength(253) @Matches(/^[a-zA-Z0-9.-]*$/) host?: string;
  @IsInt() @Min(1) @Max(65535) port!: number;
  @IsBoolean() secure!: boolean;
  @IsOptional() @IsString() @MaxLength(255) @Matches(/^[^\r\n]*$/) username?: string;
  @IsOptional() @IsString() @MaxLength(512) password?: string;
  @IsOptional() @IsString() @MaxLength(255) @Matches(/^[^\r\n]*$/) fromName?: string;
  @IsOptional() @IsEmail() @MaxLength(255) fromEmail?: string;
  @IsOptional() @IsEmail() @MaxLength(255) replyTo?: string | null;
}
export class PlatformRuntimeDto extends ServiceChangeDto {
  @IsIn(RUNTIME_PROVIDERS.map((p) => p.id)) provider!: string;
  @IsOptional() @IsString() @MaxLength(512) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(512) @Matches(/^[^\r\n]*$/) defaultModel?: string;
  @IsOptional() @IsString() @MaxLength(512) @Matches(/^[^\r\n]*$/) baseUrl?: string;
}
