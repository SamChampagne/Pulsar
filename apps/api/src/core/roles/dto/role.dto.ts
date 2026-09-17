import { IsArray, IsOptional, IsString, Matches } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'key must be kebab-case (a-z, 0-9, -)' })
  key!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Permission keys from the platform catalog (e.g. "transportation.orders.read"). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionKeys?: string[];
}

export class CreateRoleFromTemplateDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'templateKey must be kebab-case (a-z, 0-9, -)' })
  templateKey!: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionKeys?: string[];
}
