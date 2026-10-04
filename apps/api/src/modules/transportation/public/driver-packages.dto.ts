import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { DeliveryPackageStatus } from '@pulsar/shared';

class DriverPackageOperationDto {
  @IsUUID('4') operationKey!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsDateString() expectedLoadUpdatedAt!: string;
}
export class DriverPackageTransitionDto extends DriverPackageOperationDto {
  @IsIn([DeliveryPackageStatus.LOADED, DeliveryPackageStatus.DELIVERED])
  target!: DeliveryPackageStatus.LOADED | DeliveryPackageStatus.DELIVERED;
  @IsOptional() @IsString() @MaxLength(120) recipientName?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class DriverPackageExceptionDto extends DriverPackageOperationDto {
  @IsIn(['DAMAGE', 'REFUSED', 'MISSING', 'ABSENT', 'OTHER']) kind!:
    | 'DAMAGE'
    | 'REFUSED'
    | 'MISSING'
    | 'ABSENT'
    | 'OTHER';
  @IsString() @IsNotEmpty() @MaxLength(1000) note!: string;
}
