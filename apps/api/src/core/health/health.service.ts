import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isInstalled as isAgentRuntimeInstalled } from '../agents/runtime-install';
import { isInstalled as isApsRuntimeInstalled } from '../aps/runtime-install';

export interface HealthCheckResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface ReadinessResult {
  status: 'ok' | 'error';
  checks: {
    postgres: HealthCheckResult;
    agentRuntime: HealthCheckResult;
    aps: HealthCheckResult;
  };
}

/**
 * Backs the /health/* endpoints (rule: infra-only, tenant-agnostic, no secrets
 * in the response). Postgres is the only check that can flip readiness to
 * "error" — the Hermes agent runtime and APS engine are optional per-tenant/
 * best-effort dependencies (CLAUDE.md rule 24), so their checks are informative
 * only and never fail readiness.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  liveness() {
    return {
      status: 'ok' as const,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessResult> {
    const [postgres, agentRuntime, aps] = await Promise.all([
      this.checkPostgres(),
      this.checkAgentRuntime(),
      this.checkAps(),
    ]);

    return {
      status: postgres.ok ? 'ok' : 'error',
      checks: { postgres, agentRuntime, aps },
    };
  }

  private async checkPostgres(): Promise<HealthCheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true };
    } catch (err) {
      // Never surface the raw error (may embed the connection string) — log
      // server-side only, return a generic marker in the response body.
      this.logger.warn(`postgres healthcheck failed: ${(err as Error).message}`);
      return { ok: false, error: 'unreachable' };
    }
  }

  private checkAgentRuntime(): HealthCheckResult {
    try {
      return { ok: true, installed: isAgentRuntimeInstalled() };
    } catch (err) {
      // Public endpoint — never echo a raw error (may embed a filesystem path).
      this.logger.warn(`agent-runtime healthcheck failed: ${(err as Error).message}`);
      return { ok: false, error: 'unavailable' };
    }
  }

  private checkAps(): HealthCheckResult {
    try {
      return { ok: true, installed: isApsRuntimeInstalled() };
    } catch (err) {
      this.logger.warn(`aps healthcheck failed: ${(err as Error).message}`);
      return { ok: false, error: 'unavailable' };
    }
  }
}
