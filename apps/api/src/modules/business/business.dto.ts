import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsNumber,
  IsObject,
  IsInt,
  IsUUID,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CatalogItemKind,
  ServiceProjectStatus,
  ServiceJobStatus,
  SupplierOrderStatus,
  ServiceTimeStatus,
  ServiceTimeReviewAction,
} from '@pulsar/shared';
import { IsContactPhone } from '../../common/validators/contact';
import { ListQueryDto } from '../../common/dto/list-query.dto';
const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const Optional = () => ValidateIf((_o, value) => value !== undefined);
export class BusinessQueryDto extends ListQueryDto {
  @IsOptional() @IsEnum(SupplierOrderStatus) orderStatus?: SupplierOrderStatus;
  @IsOptional() @IsIn(['late']) orderFollowup?: string;
  @IsOptional() @IsString() @MaxLength(100) projectId?: string;
  @IsOptional() @IsIn(['true', 'false']) active?: string;
  @IsOptional() @IsEnum(ServiceJobStatus) status?: ServiceJobStatus;
  @IsOptional() @IsIn(['mine', 'unassigned']) assignment?: string;
}
export class VersionDto {
  @IsDateString() expectedUpdatedAt!: string;
}
export class CatalogStockLinkDto extends VersionDto {
  @ValidateIf((_o, value) => value !== null) @IsString() @Length(1, 100) wmsItemId!: string | null;
}
export class ServicePartQueryDto extends ListQueryDto {
  @IsOptional() @IsString() @Length(1, 100) catalogItemId?: string;
}
export class ConsumeServicePartDto extends VersionDto {
  @IsString() @Length(1, 100) catalogItemId!: string;
  @IsString() @Length(1, 100) binId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1000000000) quantity!: number;
  @IsString() @Trim() @Length(1, 1000) note!: string;
  @IsUUID('4') operationKey!: string;
}
export class ReturnServicePartDto extends VersionDto {
  @IsString() @Trim() @Length(1, 1000) reason!: string;
  @IsUUID('4') operationKey!: string;
}
export class CreatePartnerDto {
  @IsString() @Trim() @Length(1, 50) code!: string;
  @IsString() @Trim() @Length(1, 200) name!: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @IsString() @IsContactPhone() @MaxLength(40) phone?: string | null;
  @IsBoolean() isCustomer!: boolean;
  @IsBoolean() isSupplier!: boolean;
}
export class UpdatePartnerDto extends PartialType(OmitType(CreatePartnerDto, ['code'] as const), {
  skipNullProperties: false,
}) {
  @IsDateString() expectedUpdatedAt!: string;
  @Optional() @IsBoolean() active?: boolean;
}
export class CreateCatalogItemDto {
  @IsString() @Trim() @Length(1, 50) code!: string;
  @IsString() @Trim() @Length(1, 200) name!: string;
  @IsEnum(CatalogItemKind) kind!: CatalogItemKind;
  @IsIn(['EA', 'H', 'KG', 'L', 'M', 'BOX', 'DAY']) unit!: string;
  @Optional() @IsString() @MaxLength(4000) description?: string;
}
export class UpdateCatalogItemDto extends PartialType(
  OmitType(CreateCatalogItemDto, ['code', 'kind', 'unit'] as const),
  { skipNullProperties: false },
) {
  @IsDateString() expectedUpdatedAt!: string;
  @Optional() @IsBoolean() active?: boolean;
}
export class CreateProjectDto {
  @IsString() @Trim() @Length(1, 200) title!: string;
  @IsString() @Length(1, 100) partnerId!: string;
  @Optional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?:
    | string
    | null;
}
export class UpdateProjectDto extends PartialType(CreateProjectDto, { skipNullProperties: false }) {
  @IsDateString() expectedUpdatedAt!: string;
}
export class ProjectTransitionDto extends VersionDto {
  @IsEnum(ServiceProjectStatus) status!: ServiceProjectStatus;
}
export class CreateJobDto {
  @IsOptional() @IsInt() @Min(1) @Max(10080) plannedMinutes?: number | null;
  @IsString() @Length(1, 100) projectId!: string;
  @IsString() @Trim() @Length(1, 200) title!: string;
  @IsOptional() @IsString() @Length(1, 100) catalogItemId?: string | null;
  @Optional() @IsString() @MaxLength(4000) instructions?: string;
  @Optional() @IsString() @MaxLength(200) assigneeLabel?: string;
  @IsOptional() @IsString() @Length(1, 100) assigneeUserId?: string | null;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) scheduledAt?:
    | string
    | null;
}
export class UpdateJobDto extends PartialType(OmitType(CreateJobDto, ['projectId'] as const), {
  skipNullProperties: false,
}) {
  @IsDateString() expectedUpdatedAt!: string;
}
export class JobTransitionDto extends VersionDto {
  @IsEnum(ServiceJobStatus) status!: ServiceJobStatus;
  @Optional() @IsString() @Trim() @MaxLength(8000) report?: string;
}
export class SupplierLineDto {
  @IsString() @Length(1, 100) catalogItemId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(1000000000) quantity!: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1000000000) unitPrice!: number;
}
export class CreateSupplierOrderDto {
  @IsString() @Length(1, 100) supplierId!: string;
  @IsIn(['CAD', 'USD', 'EUR', 'GBP']) currency!: string;
  @Optional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedDate?:
    | string
    | null;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SupplierLineDto)
  lines!: SupplierLineDto[];
}
export class UpdateSupplierOrderDto extends CreateSupplierOrderDto {
  @IsDateString() expectedUpdatedAt!: string;
}
export class SupplierOrderTransitionDto extends VersionDto {
  @IsEnum(SupplierOrderStatus) status!: SupplierOrderStatus;
  @Optional() @IsString() @Trim() @Length(1, 1000) closeReason?: string;
}
export class SupplierReceiptLineDto {
  @IsString() @Length(1, 100) orderLineId!: string;
  @IsString() @Length(1, 100) binId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(1000000000) quantity!: number;
}
export class CreateSupplierReceiptDto extends VersionDto {
  @IsUUID('4') operationKey!: string;
  @IsString() @Length(1, 100) locationId!: string;
  @IsString() @Trim() @Length(1, 1000) reference!: string;
  @Optional() @IsObject() customData?: Record<string, unknown>;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SupplierReceiptLineDto)
  lines!: SupplierReceiptLineDto[];
}

export class ServiceTimeQueryDto extends ListQueryDto {
  @IsOptional() @IsEnum(ServiceTimeStatus) status?: ServiceTimeStatus;
  @IsOptional() @IsString() @Length(1, 100) projectId?: string;
  @IsOptional() @IsString() @Length(1, 100) jobId?: string;
  @IsOptional() @IsString() @Length(1, 100) userId?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
export class ServiceTimeFieldsDto {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate!: string;
  @IsInt() @Min(1) @Max(1440) minutes!: number;
  @IsBoolean() billable!: boolean;
  @IsString() @Trim() @Length(1, 2000) note!: string;
}
export class CreateServiceTimeDto extends ServiceTimeFieldsDto {
  @IsString() @Length(1, 100) jobId!: string;
  @IsString() @Length(1, 100) userId!: string;
  @IsUUID('4') operationKey!: string;
}
export class UpdateServiceTimeDto extends ServiceTimeFieldsDto {
  @IsDateString() expectedUpdatedAt!: string;
}
export class VoidServiceTimeDto extends VersionDto {
  @IsString() @Trim() @Length(1, 1000) reason!: string;
}
export class ReviewServiceTimeDto extends VersionDto {
  @IsIn(['SUBMIT', 'WITHDRAW', 'APPROVE', 'REJECT', 'REOPEN']) action!: ServiceTimeReviewAction;
  @Optional() @IsString() @Trim() @Length(1, 1000) reason?: string;
}
