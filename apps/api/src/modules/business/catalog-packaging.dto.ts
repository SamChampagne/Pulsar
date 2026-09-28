import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
export class CreateCatalogPackageDto {
  @IsString() @Trim() @Length(1, 50) code!: string;
  @IsString() @Trim() @Length(1, 150) label!: string;
  @IsString() @Matches(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/) unitsPerPackage!: string;
  @IsBoolean() wholeOnly!: boolean;
  @ValidateIf((_o, v) => v !== undefined && v !== null) @IsString() @Length(1, 128) barcode?:
    | string
    | null;
}
export class UpdateCatalogPackageDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @IsString() @Trim() @Length(1, 150) label!: string;
  @IsBoolean() active!: boolean;
}
export class ResolvePackageDto {
  @IsString() @Length(1, 132) code!: string;
}
