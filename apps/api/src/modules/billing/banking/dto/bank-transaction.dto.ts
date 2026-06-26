import { IsDateString, IsNumber, IsOptional, IsString, Length } from 'class-validator';

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

export class ImportBankCsvDto {
  @IsString()
  bankAccountId!: string;

  @IsString()
  csv!: string;
}

export class MatchDto {
  @IsString()
  paymentId!: string;
}
