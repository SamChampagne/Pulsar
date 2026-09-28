import { Equals, IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { CURRENCIES } from '@pulsar/shared';

export class CreateFixedAssetDto {
  @IsUUID() operationKey!: string;
  @IsString() @Length(1, 40) assetCode!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(0, 80) category!: string;
  @IsString() @Length(0, 200) acquisitionReference!: string;
  @IsIn(CURRENCIES.map((c) => c.code)) currency!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) acquisitionDate!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) depreciationStartMonth!: string;
  @Matches(/^\d{1,10}(\.\d{1,2})?$/) cost!: string;
  @Matches(/^\d{1,10}(\.\d{1,2})?$/) salvageValue!: string;
  @IsInt() @Min(1) @Max(1200) usefulLifeMonths!: number;
  @Matches(/^[0-9A-Z]{1,10}$/) depreciationExpenseAccountCode!: string;
  @Matches(/^[0-9A-Z]{1,10}$/) accumulatedDepreciationAccountCode!: string;
}
export class UpdateFixedAssetDto extends CreateFixedAssetDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
export class AssetActionDto {
  @IsUUID() operationKey!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @Equals(true) confirmed!: boolean;
}
export class ActivateAssetDto extends AssetActionDto {
  @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
}
export class DepreciateDto extends AssetActionDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string;
}
export class RetireAssetDto extends AssetActionDto {
  @IsString() @Length(3, 500) reason!: string;
}
