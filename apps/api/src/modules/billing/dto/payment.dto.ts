import { PartialType } from '@nestjs/swagger';
import { PaymentPartyType, PaymentTargetType, PaymentType } from '@pulsar/shared';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString, Length, Min, ValidateNested } from 'class-validator';

export class AllocationDto {
  @IsEnum(PaymentTargetType) targetType!: PaymentTargetType;
  @IsString() targetId!: string;
  @IsNumber() @IsPositive() amount!: number;
}
export class CreatePaymentDto {
  @IsEnum(PaymentType) type!: PaymentType;
  @IsEnum(PaymentPartyType) partyType!: PaymentPartyType;
  @IsString() partyId!: string;
  @IsString() modeOfPaymentId!: string;
  @IsDateString() date!: string;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsNumber() @Min(0) totalAmount!: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AllocationDto) allocations!: AllocationDto[];
}
export class UpdatePaymentDto extends PartialType(CreatePaymentDto) {}
