import { TransportMode } from '@pulsar/shared';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { CreateOrderTemplateInput, PortalChangeRequestInput } from '../portal.service';

/**
 * Request payloads of the portal surface. Shared verbatim by the two doors —
 * the capability-link routes (`/public/portal/:token/*`) and the authenticated
 * session routes (`/portal/*`) — so validation can never drift between them.
 *
 * `originLocationId` / `destinationLocationId` carry opaque location **codes**,
 * not primary keys (rule 10); the service resolves them.
 */
export class PortalOrderDto {
  @IsOptional()
  @IsString()
  originLocationId?: string;

  @IsOptional()
  @IsString()
  destinationLocationId?: string;

  @IsOptional()
  @IsString()
  customerReference?: string;

  @IsOptional()
  @IsDateString()
  requestedPickupEarly?: string;

  @IsOptional()
  @IsDateString()
  requestedPickupLate?: string;

  @IsOptional()
  @IsDateString()
  requestedDeliveryEarly?: string;

  @IsOptional()
  @IsDateString()
  requestedDeliveryLate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalWeightKg?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  palletCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(TransportMode)
  mode?: TransportMode;

  @IsOptional()
  @IsString()
  templateId?: string;
}

export class CreateOrderTemplateDtoClass implements CreateOrderTemplateInput {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  originLocationId?: string;

  @IsOptional()
  @IsString()
  destinationLocationId?: string;

  @IsOptional()
  @IsEnum(TransportMode)
  mode?: TransportMode;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalWeightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalVolumeM3?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  palletCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class PortalChangeRequestDtoClass implements PortalChangeRequestInput {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsIn(['DATE', 'ADDRESS', 'CANCEL', 'OTHER'])
  kind!: string;

  @IsString()
  note!: string;
}

export class ShipmentCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}
