import { PortalUserRole } from '@pulsar/shared';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class InvitePortalUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MaxLength(100)
  lastName!: string;

  /** Defaults to MEMBER; ADMIN may in turn manage colleagues from the portal. */
  @IsOptional()
  @IsEnum(PortalUserRole)
  role?: PortalUserRole;
}
