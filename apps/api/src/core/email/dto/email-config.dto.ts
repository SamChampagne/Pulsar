import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertEmailConfigDto {
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
  fromName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  fromEmail?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  replyTo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() imapHost?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() imapPort?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() imapSecure?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() imapUsername?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() imapPassword?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inboundActive?: boolean;
}

export class SendTestEmailDto {
  @IsEmail()
  @MaxLength(255)
  to!: string;
}
