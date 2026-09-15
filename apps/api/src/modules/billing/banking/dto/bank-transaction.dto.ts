import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Matches,
} from 'class-validator';
import { BANK_CSV_MAX_CHARS } from '@pulsar/shared';

export class CreateBankTransactionDto {
  @IsString()
  bankAccountId!: string;

  @IsDateString()
  date!: string;

  @IsString()
  @Length(1, 200)
  description!: string;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  reference?: string;
}

export class PreviewBankCsvDto {
  @IsString()
  bankAccountId!: string;

  @IsString()
  @MaxLength(BANK_CSV_MAX_CHARS)
  csv!: string;
}

export class ImportBankCsvDto extends PreviewBankCsvDto {
  // Optional for existing API clients. The UI always sends the preview fingerprint.
  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  previewHash?: string;
}

export class MatchDto {
  @IsString()
  paymentId!: string;
}
