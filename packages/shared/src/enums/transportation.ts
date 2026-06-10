/**
 * Transportation domain enums. Source of truth; mirrored in the Prisma schema.
 *
 * Lifecycle overview (see docs/data-model.md):
 *   TransportOrder → Shipment(s) → Load → Route/Stops → Dispatch → In Transit → Delivered → Closed
 */
export enum TransportOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  PLANNED = 'PLANNED',
  IN_EXECUTION = 'IN_EXECUTION',
  COMPLETED = 'COMPLETED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum ShipmentStatus {
  PENDING = 'PENDING',
  PLANNED = 'PLANNED',
  DISPATCHED = 'DISPATCHED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum LoadStatus {
  OPEN = 'OPEN',
  PLANNED = 'PLANNED',
  DISPATCHED = 'DISPATCHED',
  IN_TRANSIT = 'IN_TRANSIT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum StopType {
  PICKUP = 'PICKUP',
  DELIVERY = 'DELIVERY',
}

export enum StopStatus {
  PENDING = 'PENDING',
  ARRIVED = 'ARRIVED',
  DEPARTED = 'DEPARTED',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
}

export enum LocationType {
  PLANT = 'PLANT',
  WAREHOUSE = 'WAREHOUSE',
  DISTRIBUTION_CENTER = 'DISTRIBUTION_CENTER',
  CUSTOMER_SITE = 'CUSTOMER_SITE',
  CARRIER_TERMINAL = 'CARRIER_TERMINAL',
  OTHER = 'OTHER',
}

export enum CarrierStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum DriverStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum AssetStatus {
  AVAILABLE = 'AVAILABLE',
  IN_SERVICE = 'IN_SERVICE',
  MAINTENANCE = 'MAINTENANCE',
  RETIRED = 'RETIRED',
}

export enum VehicleType {
  TRACTOR = 'TRACTOR',
  STRAIGHT_TRUCK = 'STRAIGHT_TRUCK',
  VAN = 'VAN',
  OTHER = 'OTHER',
}

export enum TrailerType {
  DRY_VAN = 'DRY_VAN',
  REEFER = 'REEFER',
  FLATBED = 'FLATBED',
  TANKER = 'TANKER',
  OTHER = 'OTHER',
}

export enum RateType {
  FLAT = 'FLAT',
  PER_KM = 'PER_KM',
  PER_HUNDREDWEIGHT = 'PER_HUNDREDWEIGHT',
  PER_PALLET = 'PER_PALLET',
  SPOT = 'SPOT',
}

export enum RateStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
}

export enum TrackingEventType {
  CREATED = 'CREATED',
  PLANNED = 'PLANNED',
  DISPATCHED = 'DISPATCHED',
  POSITION_UPDATE = 'POSITION_UPDATE',
  ARRIVED_AT_STOP = 'ARRIVED_AT_STOP',
  DEPARTED_STOP = 'DEPARTED_STOP',
  DELAYED = 'DELAYED',
  EXCEPTION = 'EXCEPTION',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}
