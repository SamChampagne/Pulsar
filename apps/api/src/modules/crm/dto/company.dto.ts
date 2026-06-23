import { PartialType } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { CrmCompanyStatus } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class CreateCompanyDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() domain?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsEnum(CrmCompanyStatus) status?: CrmCompanyStatus;
  @IsOptional() @IsString() ownerUserId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() carrierId?: string;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}

export class CompanyListQueryDto extends ListQueryDto {
  @IsOptional() @IsEnum(CrmCompanyStatus) status?: CrmCompanyStatus;
}
