import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { CrmDealStage } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class CreateDealDto {
  @IsString() @MinLength(1) title!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsEnum(CrmDealStage) stage?: CrmDealStage;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() ownerUserId?: string;
  @IsOptional() @IsDate() @Type(() => Date) expectedCloseDate?: Date;
}

// stage is intentionally excluded: stage changes must go through POST :id/advance (rule 2).
export class UpdateDealDto extends PartialType(OmitType(CreateDealDto, ['stage'] as const)) {}

export class AdvanceDealDto {
  @IsEnum(CrmDealStage) stage!: CrmDealStage;
}

export class DealListQueryDto extends ListQueryDto {
  @IsOptional() @IsEnum(CrmDealStage) stage?: CrmDealStage;
  @IsOptional() @IsString() companyId?: string;
}
