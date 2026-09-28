import {
  IsInt,
  IsObject,
  Min,
  IsString,
  Length,
  IsISO8601,
  IsOptional,
  Matches,
  IsIn,
} from 'class-validator';
import { PickType } from '@nestjs/swagger';
import { ListQueryDto } from '../../common/dto/list-query.dto';
export class SavePartyProfileDto {
  @IsInt() @Min(0) expectedVersion!: number;
  @IsObject() data!: Record<string, unknown>;
}
export class ReviewIdentityDto {
  @IsISO8601() expectedUpdatedAt!: string;
  @IsOptional() @IsString() @Length(1, 100) billingCustomerId?: string | null;
  @IsOptional() @IsString() @Length(1, 100) crmCompanyId?: string | null;
  @IsString() @Length(5, 500) reason!: string;
}
export class ConfirmIdentityDto extends ReviewIdentityDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
}
export class IdentityCandidatesDto extends PickType(ListQueryDto, [
  'search',
  'page',
  'pageSize',
] as const) {
  @IsIn(['customer', 'crm-company']) family!: 'customer' | 'crm-company';
}
