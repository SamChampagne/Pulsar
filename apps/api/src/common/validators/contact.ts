import { registerDecorator } from 'class-validator';
import { isValidPhone } from '@pulsar/shared';

export function IsContactPhone(): PropertyDecorator {
  return (object, propertyName) =>
    registerDecorator({
      name: 'isContactPhone',
      target: object.constructor,
      propertyName: String(propertyName),
      options: {
        message:
          'Téléphone invalide : 7 à 15 chiffres, extension facultative (ex. +1 514 555-0123 poste 42).',
      },
      validator: { validate: (value: unknown) => typeof value === 'string' && isValidPhone(value) },
    });
}
