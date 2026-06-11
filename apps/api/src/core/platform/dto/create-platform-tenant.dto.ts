import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

class PlatformTenantAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;
}

export class CreatePlatformTenantDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, {
    message: 'slug must be lowercase letters, digits and dashes',
  })
  slug!: string;

  @IsString()
  name!: string;

  /** Business module keys to enable (core is always enabled). */
  @IsArray()
  @IsString({ each: true })
  modules!: string[];

  @ValidateNested()
  @Type(() => PlatformTenantAdminDto)
  admin!: PlatformTenantAdminDto;
}
