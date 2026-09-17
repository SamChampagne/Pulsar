import {
  PortalChangeRequestKind,
  PortalChangeRequestStatus,
  TransportMode,
  TransportOrderStatus,
} from '@pulsar/shared';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import type { PortalChangeRequestInput } from '../portal-change-requests.service';
import type { CreateOrderTemplateInput } from '../portal.service';

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

  @IsEnum(PortalChangeRequestKind)
  kind!: PortalChangeRequestKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  note!: string;
}

/** Filters of the paginated portal order list (`GET /portal/orders`). */
export class PortalOrdersQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(TransportOrderStatus)
  status?: TransportOrderStatus;
}

/** Staff filter of the change-request queue. */
export class ChangeRequestsQueryDto {
  @IsOptional()
  @IsEnum(PortalChangeRequestStatus)
  status?: PortalChangeRequestStatus;
}

/** Staff answer carried by acknowledge/resolve/reject. */
export class ChangeRequestResponseDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  response?: string;
}

export class ShipmentCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}
