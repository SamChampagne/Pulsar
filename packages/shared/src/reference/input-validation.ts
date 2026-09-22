/** Permissive international formatting, but never alphabetic phone numbers. */
export const PHONE_PATTERN = /^\+?[\d\s().-]{7,25}(?:\s*(?:x|ext\.?|poste)\s*\d{1,6})?$/i;

export function isValidPhone(value: string): boolean {
  if (!value) return true;
  const main = value.split(/\s*(?:x|ext\.?|poste)\s*/i)[0];
  const digits = main.replace(/\D/g, '').length;
  return PHONE_PATTERN.test(value) && digits >= 7 && digits <= 15;
}

export function isValidPostalCode(value: string, country?: string | null): boolean {
  if (!value) return true;
  if (value.length > 12) return false;
  switch (country?.toUpperCase()) {
    case 'CA':
      return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/i.test(value);
    case 'US':
      return /^\d{5}(?:-\d{4})?$/.test(value);
    default:
      return /^[\p{L}\d][\p{L}\d -]{0,11}$/u.test(value);
  }
}
