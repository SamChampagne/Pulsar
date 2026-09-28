import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { PartyDirectoryKind } from '@pulsar/shared';
import { ListQueryDto } from '../../common/dto/list-query.dto';

export class DirectoryQueryDto extends ListQueryDto {
  @IsOptional() @IsEnum(PartyDirectoryKind) kind?: PartyDirectoryKind;
}
export class CreateDirectoryDto {
  @IsUUID('4') operationKey!: string;
  // Validated against the shared closed contract in the service on EVERY writer.
  @IsObject() entry!: Record<string, unknown>;
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(3, 500)
  reason!: string;
}
export class UpdateDirectoryDto extends CreateDirectoryDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
