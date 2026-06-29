import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { ApsClient } from '../src/core/aps/aps.client';
import { ApsRuntimeService } from '../src/core/aps/aps-runtime.service';
import { isInstalled, apsDir } from '../src/core/aps/runtime-install';
import { buildSmokeSnapshot } from '../src/core/aps/smoke-snapshot';

/**
 * Exercises the real Pulsar↔APS round-trip through the NestJS client + runtime
 * code (no Pulsar DB / auth / seed needed). Skips cleanly when the runtime is
 * not installed — run `pnpm aps:setup` first to enable it. Mirrors the gating
 * style of phase11r1-agent-runtime.e2e-spec.ts.
 */
const installed = isInstalled();
const describeIfInstalled = installed ? describe : describe.skip;

if (!installed) {
  // eslint-disable-next-line no-console
  console.warn('[aps-runtime.e2e] APS runtime not installed — skipping. Run `pnpm aps:setup`.');
}

/** Read services/aps/.env so the test uses the same port + integration key. */
function loadApsEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(path.join(apsDir(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {
    /* ignore */
  }
  return out;
}

describeIfInstalled('APS runtime foundation (e2e)', () => {
  let runtime: ApsRuntimeService;
  let client: ApsClient;

  beforeAll(async () => {
    const env = loadApsEnv();
    const config = {
      get: (key: string) =>
        ({
          APS_PORT: env.API_PORT ?? '8099',
          APS_API_KEY: env.INTEGRATION_API_KEY,
          APS_AUTOSTART: 'true',
        })[key],
    } as unknown as ConfigService;
    client = new ApsClient(config);
    runtime = new ApsRuntimeService(config, client);
    await runtime.start(); // boots uvicorn, or reuses an already-running engine
  }, 60_000);

  afterAll(() => {
    runtime?.stop();
  });

  it('reports healthy + db-ready status', async () => {
    const status = await runtime.status();
    expect(status.installed).toBe(true);
    expect(status.healthy).toBe(true);
    expect(status.dbReady).toBe(true);
  });

  it('lists scheduling strategies including greedy and cpsat', async () => {
    const caps = await client.listStrategies();
    const names = caps.strategies.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['greedy', 'cpsat']));
  });

  it('runs a snapshot round-trip and respects operation precedence (greedy)', async () => {
    const result = await client.schedule(buildSmokeSnapshot(), { strategy: 'greedy', horizonDays: 14 });
    expect(result.assignments.length).toBe(2);
    const byOp = new Map(result.assignments.map((a) => [a.operation_id, a]));
    const op1 = byOp.get('smoke-op-1')!;
    const op2 = byOp.get('smoke-op-2')!;
    expect(op1).toBeDefined();
    expect(op2).toBeDefined();
    expect(op1.machine_id).toBe('smoke-m1');
    expect(op2.machine_id).toBe('smoke-m2');
    expect(new Date(op1.start).getTime()).toBeLessThan(new Date(op1.end).getTime());
    // finish-to-start: op2 cannot start before op1 ends.
    expect(new Date(op2.start).getTime()).toBeGreaterThanOrEqual(new Date(op1.end).getTime());
  });

  it('solves the same problem optimally with the OR-Tools CP-SAT solver', async () => {
    const result = await client.schedule(buildSmokeSnapshot(), { strategy: 'cpsat', horizonDays: 14 });
    expect(result.assignments.length).toBe(2);
    expect(result.solver_status.toUpperCase()).toContain('OPTIMAL');
  }, 60_000);
});
