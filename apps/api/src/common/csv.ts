/** Spreadsheet formula-injection guard: Excel executes cells starting with = + - @ or tab. */
export function csvSafe(value: string): string {
  return /^[=+\-@\t]/.test(value) ? `'${value}` : value;
}
