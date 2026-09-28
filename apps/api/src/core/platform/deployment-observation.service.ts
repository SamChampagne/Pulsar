import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { MigrationObservation } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

export const unknownMigrations = (): MigrationObservation => ({
  state: 'UNVERIFIED',
  expected: null,
  applied: null,
  pending: null,
  failed: null,
  changed: null,
  unexpected: null,
});
type AppliedMigration = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};
/** Ignore line-ending transport changes, never SQL content changes. */
export function migrationChecksums(sql: string) {
  const lf = sql.replace(/\r\n/g, '\n');
  return [
    ...new Set(
      [sql, lf, lf.replace(/\n/g, '\r\n')].map((s) => createHash('sha256').update(s).digest('hex')),
    ),
  ];
}
export function compareMigrations(
  expected: { name: string; checksums: string[] }[],
  rows: AppliedMigration[],
): MigrationObservation {
  if (
    !expected.length ||
    expected.length > 2000 ||
    rows.length > 5000 ||
    new Set(expected.map((e) => e.name)).size !== expected.length
  )
    return unknownMigrations();
  const finished = rows.filter((r) => r.finished_at && !r.rolled_back_at);
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).length;
  const pending = expected.filter((e) => !finished.some((r) => r.migration_name === e.name)).length;
  const changed = expected.filter((e) => {
    const applied = finished.filter((r) => r.migration_name === e.name);
    return applied.length > 1 || applied.some((r) => !e.checksums.includes(r.checksum));
  }).length;
  const unexpected = new Set(
    rows
      .filter((r) => !r.rolled_back_at && !expected.some((e) => e.name === r.migration_name))
      .map((r) => r.migration_name),
  ).size;
  return {
    state: pending || failed || changed || unexpected ? 'DRIFT' : 'MATCHED',
    expected: expected.length,
    applied: finished.length,
    pending,
    failed,
    changed,
    unexpected,
  };
}

@Injectable()
export class DeploymentObservationService {
  constructor(private readonly prisma: PrismaService) {}
  async migrations(): Promise<MigrationObservation> {
    // Same monorepo location from src/ and dist/, including the existing Docker image.
    const root = resolve(__dirname, '../../../../../packages/database/prisma/migrations');
    try {
      const dirs = (await readdir(root, { withFileTypes: true })).filter(
        (d) => d.isDirectory() && /^\d{14}_[a-zA-Z0-9_]+$/.test(d.name),
      );
      if (!dirs.length || dirs.length > 2000) return unknownMigrations();
      const expected = [];
      // Bounded concurrency: this runs on operator refresh, never on a business write.
      for (let i = 0; i < dirs.length; i += 16) {
        expected.push(
          ...(await Promise.all(
            dirs.slice(i, i + 16).map(async (d) => ({
              name: d.name,
              checksums: migrationChecksums(
                await readFile(resolve(root, d.name, 'migration.sql'), 'utf8'),
              ),
            })),
          )),
        );
      }
      const rows = await this.prisma.$queryRaw<AppliedMigration[]>`
        SELECT migration_name, checksum, finished_at, rolled_back_at
        FROM "_prisma_migrations" ORDER BY started_at LIMIT 5001`;
      return compareMigrations(expected, rows);
    } catch {
      // Missing table/bundle, permission error or I/O failure: unknown, not healthy.
      return unknownMigrations();
    }
  }
}
