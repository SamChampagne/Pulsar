import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateModeOfPaymentDto {
  @IsString() @Length(1, 60) name!: string;
  @IsString() @Matches(/^[0-9A-Z]{1,10}$/) accountCode!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class UpdateModeOfPaymentDto extends PartialType(CreateModeOfPaymentDto) {}
