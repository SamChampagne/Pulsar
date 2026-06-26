import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ApsHealth,
  ApsReadiness,
  ApsSnapshot,
  RunFromSnapshotRequest,
  RunScheduleResponse,
  StrategyCapabilitiesResponse,
} from './aps.types';

/**
 * Typed HTTP client for the vendored APS engine (loopback only). Every call is
 * bounded by a timeout and any network error / non-2xx is mapped to a 503 —
 * the engine is a best-effort sidecar (spec hard-rule-24 analog): Pulsar never
 * crashes because the APS engine is down or slow.
 */
@Injectable()
export class ApsClient {
  private readonly logger = new Logger(ApsClient.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const port = this.config.get<string>('APS_PORT') ?? '8099';
    return `http://127.0.0.1:${port}`;
  }

  private apiKey(): string | undefined {
    return this.config.get<string>('APS_API_KEY') ?? undefined;
  }

  /** Low-level fetch with timeout; maps failures to ServiceUnavailableException. */
  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; timeoutMs?: number; withKey?: boolean } = {},
  ): Promise<T> {
    const { body, timeoutMs = 30_000, withKey = false } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withKey) {
      const key = this.apiKey();
      if (key) headers['X-API-Key'] = key;
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(`APS ${method} ${path} failed: ${detail}`);
      throw new ServiceUnavailableException(`APS engine unreachable (${detail})`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`APS ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException(`APS engine error (HTTP ${res.status})`);
    }
    return (await res.json()) as T;
  }

  /** Liveness — fast probe (no DB). */
  health(): Promise<ApsHealth> {
    return this.call<ApsHealth>('GET', '/health', { timeoutMs: 3_000 });
  }

  /** Readiness — reports whether the engine's DB/migrations are ready. */
  ready(): Promise<ApsReadiness> {
    return this.call<ApsReadiness>('GET', '/ready', { timeoutMs: 3_000 });
  }

  /** Available scheduling strategies + their capabilities (open endpoint). */
  listStrategies(): Promise<StrategyCapabilitiesResponse> {
    return this.call<StrategyCapabilitiesResponse>('GET', '/scheduling/strategies', {
      timeoutMs: 5_000,
    });
  }

  /**
   * Stateless one-shot: push a canonical snapshot and run a schedule in a single
   * call. Gated by the engine's integration API key. This is the foundation's
   * primary scheduling entry point; later sub-projects add persisted runs.
   */
  runFromSnapshot(
    req: RunFromSnapshotRequest,
    timeoutMs = 60_000,
  ): Promise<RunScheduleResponse> {
    return this.call<RunScheduleResponse>('POST', '/integration/scheduling/run-from-snapshot', {
      body: req,
      withKey: true,
      timeoutMs,
    });
  }

  /** Convenience: snapshot + strategy → schedule, with a default objective. */
  schedule(
    snapshot: ApsSnapshot,
    opts: { strategy?: string; horizonStart?: string; horizonDays?: number } = {},
  ): Promise<RunScheduleResponse> {
    return this.runFromSnapshot({
      snapshot,
      strategy: opts.strategy ?? 'greedy',
      horizon_start: opts.horizonStart ?? null,
      horizon_days: opts.horizonDays ?? 30,
    });
  }
}
