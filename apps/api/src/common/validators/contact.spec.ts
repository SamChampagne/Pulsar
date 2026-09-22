import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCarrierDto,
  UpdateCarrierDto,
} from '../../modules/transportation/carriers/dto/carrier.dto';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
} from '../../modules/transportation/customers/dto/customer.dto';
import { CreateLocationDto, UpdateLocationDto } from '../../core/locations/dto/location.dto';
describe('contact DTOs', () => {
  it('rejects null required fields on PATCH while allowing optional contact fields to be cleared', async () => {
    for (const Dto of [UpdateCarrierDto, UpdateCustomerDto, UpdateLocationDto]) {
      const errors = await validate(plainToInstance<object, object>(Dto, { name: null }));
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    }
    expect(
      await validate(plainToInstance(UpdateCustomerDto, { email: null, phone: null })),
    ).toEqual([]);
    expect(await validate(plainToInstance(UpdateCarrierDto, { status: null }))).not.toEqual([]);
    expect(await validate(plainToInstance(UpdateLocationDto, { country: null }))).not.toEqual([]);
  });
  it('rejects text as phone at the server, including updates', async () => {
    for (const Dto of [CreateCarrierDto, CreateCustomerDto, UpdateCarrierDto, UpdateCustomerDto]) {
      const errors = await validate(
        plainToInstance<object, object>(Dto, { code: 'C1', name: 'Client', phone: 'bonjour' }),
      );
      expect(errors.some((e) => e.property === 'phone')).toBe(true);
    }
  });
  it('normalizes codes/names, accepts international phone and nullable optional fields', async () => {
    const dto = plainToInstance(UpdateCarrierDto, {
      name: ' Transport Est ',
      scacCode: 'abcd',
      phone: '+1 514 555-0123 poste 42',
      email: null,
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.name).toBe('Transport Est');
    expect(dto.scacCode).toBe('ABCD');
  });
  it('rejects blank names and overly long fields', async () => {
    const errors = await validate(
      plainToInstance(CreateCustomerDto, { code: '', name: '   ', contactName: 'a'.repeat(151) }),
    );
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['code', 'name', 'contactName']),
    );
  });
  it('bounds coordinates and postal input', async () => {
    const errors = await validate(
      plainToInstance(CreateLocationDto, {
        code: 'WH',
        name: 'Lieu',
        type: 'WAREHOUSE',
        addressLine1: '12 Rue',
        city: 'Laval',
        latitude: 91,
        longitude: -181,
        postalCode: '1'.repeat(18),
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(
      expect.arrayContaining(['latitude', 'longitude', 'postalCode']),
    );
  });
});
