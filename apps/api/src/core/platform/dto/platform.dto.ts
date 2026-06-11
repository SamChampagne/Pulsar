import { ApiProperty } from '@nestjs/swagger';
import { TenantStatus } from '@pulsar/shared';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Initial administrator provisioned together with a new tenant. */
export class TenantAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  /** Omit to invite the admin (one-shot link to set their own password). */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class CreateTenantDto {
  /** URL-safe tenant identifier, unique platform-wide. */
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, {
    message: 'slug must be 3-40 chars, lowercase letters, digits and hyphens',
  })
  slug!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  /** Business module keys to enable on creation (core is always enabled). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modules?: string[];

  @ApiProperty({ type: TenantAdminDto })
  @ValidateNested()
  @Type(() => TenantAdminDto)
  admin!: TenantAdminDto;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;
}

export class ToggleModuleDto {
  @IsBoolean()
  enabled!: boolean;
}
