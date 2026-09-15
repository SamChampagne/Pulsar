import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

export class MaterialContextDto {
  @IsString() @MinLength(1) @MaxLength(128) locationId!: string;
  @IsString() @MinLength(1) @MaxLength(128) bomRevisionId!: string;
  @IsDateString() expectedUpdatedAt!: string;
}
