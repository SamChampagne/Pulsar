import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { DisputeReasonCode } from '@pulsar/shared';

class ReconcileLineDto {
  @IsString()
  lineId!: string;

  @IsNumber()
  invoicedAmount!: number;
}

export class ReconcileInvoiceDto {
  @IsString()
  carrierInvoiceNumber!: string;

  /** Lines omitted here default to the expected amount. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReconcileLineDto)
  lines!: ReconcileLineDto[];
}

export class ResolveDisputeDto {
  @IsIn(['ACCEPT_INVOICED', 'KEEP_EXPECTED'])
  resolution!: 'ACCEPT_INVOICED' | 'KEEP_EXPECTED';

  @IsIn(Object.values(DisputeReasonCode))
  reasonCode!: DisputeReasonCode;

  @IsOptional()
  @IsString()
  note?: string;
}

export class MarkPaidDto {
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
