import { PartialType } from '@nestjs/swagger';
import {
  ManufacturingFirmness,
  ManufacturingOrderStatus,
  ManufacturingPriority,
} from '@pulsar/shared';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ListQueryDto } from '../../../../common/dto/list-query.dto';

export class CreateOperationDto {
  @IsInt()
  sequence!: number;

  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  durationMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  setupMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleWorkCenterIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependsOn?: string[];
}

export class UpdateOperationDto extends PartialType(CreateOperationDto) {}

export class CreateManufacturingOrderDto {
  @IsString()
  name!: string;

  @IsString()
  productRef!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsDateString()
  dueDate!: string;

  @IsDateString()
  releaseDate!: string;

  @IsOptional()
  @IsEnum(ManufacturingPriority)
  priority?: ManufacturingPriority;

  @IsOptional()
  @IsEnum(ManufacturingFirmness)
  firmness?: ManufacturingFirmness;

  @IsOptional()
  @IsString()
  routingId?: string;

  @IsOptional()
  @IsString()
  bomId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOperationDto)
  operations?: CreateOperationDto[];
}

export class UpdateManufacturingOrderDto extends PartialType(CreateManufacturingOrderDto) {}

export class ManufacturingOrderListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(ManufacturingOrderStatus)
  status?: ManufacturingOrderStatus;
}

export class FromRoutingDto {
  @IsString()
  routingId!: string;
}
