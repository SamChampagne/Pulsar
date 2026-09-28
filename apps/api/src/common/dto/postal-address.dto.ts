import { Transform, Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
  registerDecorator,
} from 'class-validator';
import { Prisma } from '@pulsar/database';
const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
export class PostalAddressDto {
  @IsString() @Trim() @Length(1, 200) line1!: string;
  @IsOptional() @IsString() @Trim() @MaxLength(200) line2?: string;
  @IsString() @Trim() @Length(1, 100) city!: string;
  @IsOptional() @IsString() @Trim() @MaxLength(100) region?: string;
  @IsString() @Matches(/^[A-Z]{2}$/) countryCode!: string;
  @IsOptional() @IsString() @Trim() @MaxLength(20) postalCode?: string;
}
/** Syntax check, not postal deliverability or a geocoding/tax determination. */
function AddressPostalCode(): PropertyDecorator {
  return (object, propertyName) =>
    registerDecorator({
      name: 'addressPostalCode',
      target: object.constructor,
      propertyName: String(propertyName),
      options: { message: 'Code postal invalide pour le Canada ou les États-Unis.' },
      validator: {
        validate(value: unknown) {
          if (!value || typeof value !== 'object') return false;
          const a = value as PostalAddressDto;
          if (a.countryCode === 'CA')
            return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i.test(
              a.postalCode ?? '',
            );
          if (a.countryCode === 'US') return /^\d{5}(-\d{4})?$/.test(a.postalCode ?? '');
          return true;
        },
      },
    });
}
export class ContactAddressesDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PostalAddressDto)
  @AddressPostalCode()
  billingAddress?: PostalAddressDto | null;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PostalAddressDto)
  @AddressPostalCode()
  shippingAddress?: PostalAddressDto | null;
}
export function addressData(dto: ContactAddressesDto) {
  const json = (v: PostalAddressDto | null | undefined) =>
    v === undefined ? undefined : v === null ? Prisma.DbNull : ({ ...v } as Prisma.InputJsonObject);
  return { billingAddress: json(dto.billingAddress), shippingAddress: json(dto.shippingAddress) };
}
