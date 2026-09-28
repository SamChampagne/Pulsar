import { Type, Transform } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsInt,
  IsString,
  Length,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

class CoordinateReferenceDto {
  @IsString() @Length(1, 100) id!: string;
  @IsInt() @Min(1) version!: number;
}
class CoordinateSelectionsDto {
  @ValidateIf((o) => o.billingAddress !== null)
  @IsDefined()
  @ValidateNested()
  @Type(() => CoordinateReferenceDto)
  billingAddress!: CoordinateReferenceDto | null;
  @ValidateIf((o) => o.deliveryAddress !== null)
  @IsDefined()
  @ValidateNested()
  @Type(() => CoordinateReferenceDto)
  deliveryAddress!: CoordinateReferenceDto | null;
  @ValidateIf((o) => o.contact !== null)
  @IsDefined()
  @ValidateNested()
  @Type(() => CoordinateReferenceDto)
  contact!: CoordinateReferenceDto | null;
}
export class SaveDocumentCoordinatesDto {
  @IsDateString() expectedUpdatedAt!: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => CoordinateSelectionsDto)
  selections!: CoordinateSelectionsDto;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 500)
  reason!: string;
}
