import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ContactAddressesDto } from './postal-address.dto';
import { UpdatePreferencesDto } from '../../core/preferences/dto/desk-layout.dto';
const address = {
  line1: '12 Rue du Port',
  city: 'Montréal',
  countryCode: 'CA',
  postalCode: 'H2Y 1C6',
};
const errors = (body: object) =>
  validate(plainToInstance(ContactAddressesDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
describe('Structured contact addresses', () => {
  it('keeps independent addresses and permits explicit clearing', async () => {
    expect(
      await errors({
        billingAddress: address,
        shippingAddress: { ...address, city: 'Boston', countryCode: 'US', postalCode: '02108' },
      }),
    ).toHaveLength(0);
    expect(await errors({ billingAddress: null })).toHaveLength(0);
  });
  it.each([
    { billingAddress: { ...address, postalCode: '123456789123456789' } },
    { billingAddress: { ...address, countryCode: 'US', postalCode: 'ABC' } },
    { shippingAddress: { city: 'Boston' } },
    { shippingAddress: { ...address, tenantId: 'foreign' } },
    { shippingAddress: 'free text' },
    { billingAddress: [] },
    { shippingAddress: [address] },
  ])('rejects incomplete, spoofed and malformed input', async (body) =>
    expect((await errors(body)).length).toBeGreaterThan(0),
  );
});
describe('User time-zone preference DTO', () => {
  it('validates zones and allows device mode', async () => {
    for (const zone of [null, 'UTC', 'America/Toronto', 'Asia/Kolkata'])
      expect(
        await validate(plainToInstance(UpdatePreferencesDto, { timeZone: zone })),
      ).toHaveLength(0);
    expect(
      (await validate(plainToInstance(UpdatePreferencesDto, { timeZone: 'Invented/Invalid' })))
        .length,
    ).toBeGreaterThan(0);
  });
});
