import { PartialType } from '@nestjs/swagger';
import { AccessorialUnit } from '@pulsar/shared';
import { IsEnum, IsString, Matches } from 'class-validator';

export class CreateAccessorialDto {
  /** Stable identifier used by rate prices and load flags (e.g. TAILGATE). */
  @IsString()
  @Matches(/^[A-Z0-9_-]{2,32}$/, { message: 'code must be 2-32 chars of A-Z, 0-9, _ or -' })
  code!: string;

  @IsString()
  name!: string;

  @IsEnum(AccessorialUnit)
  unit!: AccessorialUnit;
}

export class UpdateAccessorialDto extends PartialType(CreateAccessorialDto) {}
