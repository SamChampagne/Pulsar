import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { DisputeReasonCode } from '@pulsar/shared';

class IncomingLineDto {
  @IsString() lineRef!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() chargedAmount!: number;
}

export class CreateIncomingInvoiceDto {
  @IsString() carrierId!: string;
  @IsString() carrierInvoiceNumber!: string;
  @IsOptional() @IsString() currency?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IncomingLineDto)
  lines!: IncomingLineDto[];
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
}

export class FreightDisputeDto {
  @IsIn(Object.values(DisputeReasonCode)) reasonCode!: DisputeReasonCode;
  @IsOptional() @IsString() note?: string;
}

export class FreightResolveDto {
  @IsIn(['ACCEPT_CHARGED', 'KEEP_EXPECTED']) resolution!: 'ACCEPT_CHARGED' | 'KEEP_EXPECTED';
  @IsIn(Object.values(DisputeReasonCode)) reasonCode!: DisputeReasonCode;
  @IsOptional() @IsString() note?: string;
}

export class FreightPayDto {
  @IsOptional() @IsString() paidAt?: string;
}

export class LinkFreightInvoiceDto {
  @IsString() invoiceId!: string;
}
