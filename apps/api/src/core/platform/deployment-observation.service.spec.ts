import {
  compareMigrations,
  migrationChecksums,
  unknownMigrations,
  DeploymentObservationService,
} from './deployment-observation.service';
import { PrismaService } from '../../prisma/prisma.service';
const expected = [{ name: 'first', checksums: migrationChecksums('SELECT 1;\n') }];
const row = {
  migration_name: 'first',
  checksum: expected[0].checksums[0],
  finished_at: new Date(),
  rolled_back_at: null,
};
describe('Deployment migration observation', () => {
  it('compares names and checksums, not only counts', () => {
    expect(compareMigrations(expected, [row])).toMatchObject({
      state: 'MATCHED',
      expected: 1,
      applied: 1,
    });
    expect(compareMigrations(expected, [{ ...row, migration_name: 'other' }])).toMatchObject({
      state: 'DRIFT',
      pending: 1,
      unexpected: 1,
    });
    expect(compareMigrations(expected, [{ ...row, checksum: 'changed' }])).toMatchObject({
      state: 'DRIFT',
      changed: 1,
    });
  });
  it('preserves SQL differences while accepting CRLF/LF transport', () => {
    expect(migrationChecksums('SELECT 1;\n')).toEqual(
      migrationChecksums('SELECT 1;\r\n').sort(
        (a, b) => expected[0].checksums.indexOf(a) - expected[0].checksums.indexOf(b),
      ),
    );
    expect(migrationChecksums('SELECT 2;\n').some((s) => expected[0].checksums.includes(s))).toBe(
      false,
    );
  });
  it('blocks incomplete and duplicate applications and ignores rolled-back attempts', () => {
    expect(compareMigrations(expected, [{ ...row, finished_at: null }])).toMatchObject({
      state: 'DRIFT',
      pending: 1,
      failed: 1,
    });
    expect(compareMigrations(expected, [row, row])).toMatchObject({ state: 'DRIFT', changed: 1 });
    expect(
      compareMigrations(expected, [row, { ...row, finished_at: null, rolled_back_at: new Date() }])
        .state,
    ).toBe('MATCHED');
  });
  it('reports unknown for unavailable or truncated inventories', () => {
    expect(compareMigrations([], [])).toEqual(unknownMigrations());
    expect(compareMigrations(expected, Array(5001).fill(row))).toEqual(unknownMigrations());
  });
  it('does not expose database errors or mistake a failed read for a clean schema', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('DATABASE_URL secret')) };
    const result = await new DeploymentObservationService(
      prisma as unknown as PrismaService,
    ).migrations();
    expect(result).toEqual(unknownMigrations());
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
