import { Equals, IsIn, IsInt, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { CURRENCIES } from '@pulsar/shared';
export class LedgerQualificationReviewDto {
  @IsIn(['QUALIFY', 'WITHDRAW']) action!: 'QUALIFY' | 'WITHDRAW';
  @IsIn(['', ...CURRENCIES.map((c) => c.code)]) currency!: string;
  @IsString() @Length(10, 2000) reason!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @Matches(/^[a-zA-Z0-9_-]{1,100}$/) evidenceId!: string;
}
export class LedgerQualificationConfirmDto extends LedgerQualificationReviewDto {
  @IsUUID('4') operationKey!: string;
  @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
  @Equals(true) confirmed!: boolean;
}
export class LedgerEvidenceDto {
  @IsUUID('4') operationKey!: string;
  @IsString() @Length(3, 1000) caption!: string;
}
