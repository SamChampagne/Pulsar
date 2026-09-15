import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
export class SupplierDto {
  @Matches(/^[A-Za-z0-9_-]{1,40}$/) code!: string;
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsEmail() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(2000) terms?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
export class PurchaseVersionDto {
  @IsDateString() expectedUpdatedAt!: string;
}
export class PurchaseTermsDto {
  @IsString() @MinLength(1) supplierId!: string;
  @Matches(/^\d{1,10}(\.\d{1,6})?$/) unitPrice!: string;
  @IsIn(['CAD', 'USD', 'EUR']) currency!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedDate!: string;
  @IsOptional() @IsString() @MaxLength(2000) terms?: string;
}
export class CreatePurchaseDto extends PurchaseTermsDto {
  @IsString() @MinLength(1) preparationId!: string;
  @IsUUID() operationKey!: string;
  @IsDateString() expectedUpdatedAt!: string;
}
export class UpdatePurchaseDto extends PurchaseTermsDto {
  @IsDateString() expectedUpdatedAt!: string;
}
export class ConfirmPurchaseDto extends PurchaseVersionDto {
  @IsString() @MinLength(1) @MaxLength(160) supplierReference!: string;
}
export class PurchaseReceiptDto extends PurchaseVersionDto {
  @IsUUID() operationKey!: string;
  @IsString() @MinLength(1) toBinId!: string;
  @Matches(/^\d{1,10}(\.\d{1,3})?$/) quantity!: string;
}
export class PurchaseListDto extends ListQueryDto {
  @IsOptional() @IsString() locationId?: string;
}
