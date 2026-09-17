export interface LocationRecord {
  id: string;
  code: string;
  name: string;
  type: string;
  customerId: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  isActive: boolean;
}
