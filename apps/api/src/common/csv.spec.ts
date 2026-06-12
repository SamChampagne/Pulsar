import { csvSafe } from './csv';

describe('csvSafe', () => {
  it('prefixes formula-injection starters with a quote', () => {
    for (const v of ['=cmd|/c calc', '+1', '-1', '@SUM(A1)', '\tx']) {
      expect(csvSafe(v)).toBe(`'${v}`);
    }
  });
  it('leaves ordinary values untouched', () => {
    expect(csvSafe('Carrier énorme, "quoted"')).toBe('Carrier énorme, "quoted"');
    expect(csvSafe('123.45')).toBe('123.45');
  });
});
