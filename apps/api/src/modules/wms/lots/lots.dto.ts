import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  Length,
  Matches,
  IsUUID,
  IsInt,
  Min,
  ValidateIf,
  IsIn,
} from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
export class CreateLotDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  @Matches(/^[^\x00-\x1f\x7f]+$/)
  code!: string;
  @IsOptional() @IsString() @Length(1, 100) supplierLot?: string;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  manufacturedOn?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresOn?: string;
}
export class LotQueryDto extends ListQueryDto {
  @IsOptional() @IsString() @Length(1, 100) lotId?: string;
  @IsOptional() @IsString() @Length(1, 100) binId?: string;
  @IsOptional() @IsIn(['true']) releaseEligible?: string;
}

export class HoldLotDto {
  @IsUUID('4') operationKey!: string;
  @IsInt() @Min(0) expectedRevision!: number;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 1000)
  reason!: string;
}
export class ReleaseLotDto extends HoldLotDto {
  @ValidateIf(
    (o) => o.qualityInspectionId !== undefined || o.expectedInspectionUpdatedAt !== undefined,
  )
  @IsString()
  @Length(1, 100)
  qualityInspectionId?: string;
  @ValidateIf(
    (o) => o.qualityInspectionId !== undefined || o.expectedInspectionUpdatedAt !== undefined,
  )
  @IsDateString()
  expectedInspectionUpdatedAt?: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(10, 2000)
  controlNote!: string;
}
