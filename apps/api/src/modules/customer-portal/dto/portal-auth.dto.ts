import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class PortalLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  /** Tenant slug — only required when the email is a portal account in several tenants. */
  @IsOptional()
  @IsString()
  tenant?: string;
}

export class PortalRefreshDto {
  @IsString()
  refreshToken!: string;
}

export class PortalForgotDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  tenant?: string;
}

export class PortalResetDto {
  /** One-shot INVITATION or PASSWORD_RESET token from the emailed link. */
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
