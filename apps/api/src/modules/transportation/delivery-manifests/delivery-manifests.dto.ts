import { IsDateString, IsString, IsUUID, Length, Matches } from 'class-validator';

export class IssueDeliveryManifestDto {
  @IsUUID('4') operationKey!: string;
  @IsDateString({ strict: true }) expectedLoadUpdatedAt!: string;
  @Matches(/^[a-f0-9]{64}$/) sourceHash!: string;
  @IsString() @Length(1, 300) reason!: string;
}
