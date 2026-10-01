import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsDateString,
  ValidateIf,
  Matches,
  Equals,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertEmailConfigDto {
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  expectedUpdatedAt?: string | null;

  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  username?: string;

  /** Raw password — encrypted before persistence. Omit to preserve the stored secret. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[^\r\n]*$/)
  fromName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  fromEmail?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  replyTo?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) imapHost?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(65535) imapPort?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() imapSecure?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) imapUsername?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) imapPassword?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inboundActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inboundLive?: boolean;
  @IsOptional() @Equals(true) confirmInboundLive?: boolean;
}

export class SendTestEmailDto {
  @IsEmail()
  @MaxLength(255)
  to!: string;
}
