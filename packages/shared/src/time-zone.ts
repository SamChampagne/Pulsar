/** IANA zones, not fixed offsets: DST must be resolved at the displayed instant. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100 || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimeZone(zone) ? zone : 'UTC';
}
