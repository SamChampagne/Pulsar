import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ServiceQuoteStatus } from '@pulsar/shared';
import { VersionDto } from './business.dto';
export class QuoteLineDto {
  @IsString() @Length(1, 100) catalogItemId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(1000000) quantity!: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(10000000) unitPrice!: number;
}
export class QuoteFieldsDto {
  @IsString() @Length(1, 100) partnerId!: string;
  @IsString() @Length(1, 200) title!: string;
  @IsIn(['CAD', 'USD', 'EUR', 'GBP']) currency!: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?:
    | string
    | null;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];
}
export class CreateServiceQuoteDto extends QuoteFieldsDto {
  @IsUUID('4') operationKey!: string;
}
export class UpdateServiceQuoteDto extends QuoteFieldsDto {
  @IsDateString() expectedUpdatedAt!: string;
}
export class TransitionServiceQuoteDto extends VersionDto {
  @IsEnum(ServiceQuoteStatus) status!: ServiceQuoteStatus;
}
export class InvoiceSourceDto {
  @IsIn(['time', 'part']) kind!: 'time' | 'part';
  @IsString() @Length(1, 100) id!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(10000000) unitPrice!: number;
  @IsDateString() expectedVersion!: string;
}
export class InvoiceServiceWorkDto {
  @IsUUID('4') operationKey!: string;
  @IsIn(['CAD', 'USD', 'EUR', 'GBP']) currency!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceSourceDto)
  sources!: InvoiceSourceDto[];
}
export class PartnerLinksDto extends VersionDto {
  @IsOptional() @IsString() @Length(1, 100) billingCustomerId?: string | null;
  @IsOptional() @IsString() @Length(1, 100) crmCompanyId?: string | null;
}
