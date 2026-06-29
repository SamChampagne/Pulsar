import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreateBankAccountDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Z]{1,10}$/)
  glAccountCode?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {}
