import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  /** Optional tenant slug — required only if the same email exists in several tenants. */
  @IsOptional()
  @IsString()
  tenant?: string;
}
