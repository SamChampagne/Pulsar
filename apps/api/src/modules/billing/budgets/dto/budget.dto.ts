import { IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';

export class BudgetLineDto {
  @IsString()
  @Matches(/^[0-9A-Z]{1,10}$/)
  accountCode!: string;

  @IsNumber()
  amount!: number;
}

export class CreateBudgetDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscalYear!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines!: BudgetLineDto[];
}

export class UpdateBudgetDto extends PartialType(CreateBudgetDto) {}
