import { IsIn, IsInt, IsString, IsUUID, Length, Min, MaxLength } from 'class-validator';
import { ACCOUNTING_TARGETS, CURRENCIES, type AccountingTarget } from '@pulsar/shared';
export class AccountingProfileDto {
  @IsUUID('4') operationKey!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsIn(ACCOUNTING_TARGETS) target!: AccountingTarget;
  @IsIn(CURRENCIES.map((c) => c.code)) targetCurrency!: string;
  @IsString() @MaxLength(120) externalSystem!: string;
  @IsString() @Length(3, 500) reason!: string;
}
