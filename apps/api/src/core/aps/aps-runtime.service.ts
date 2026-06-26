import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { ApsClient } from './aps.client';
import { apsDir, isInstalled, venvPython } from './runtime-install';

/**
 * Manages the lifecycle of the vendored APS engine (a FastAPI/uvicorn process
 * bound to loopback). Best-effort and isolated, mirroring the Hermes agent
 * runtime: a missing install or a crashed engine never throws at boot and never
 * brings Pulsar down — callers see a 503 from ApsClient instead.
 *
 * One long-lived process per Pulsar API process (APS is a stateless HTTP
 * request/response service, unlike Hermes which is one process per conversation).
 */
@Injectable()
export class ApsRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApsRuntimeService.name);
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly stderrTail: string[] = [];
  private starting = false;

  constructor(
    private readonly config: ConfigService,
    private readonly client: ApsClient,
  ) {}

  private port(): string {
    return this.config.get<string>('APS_PORT') ?? '8099';
  }

  async onModuleInit(): Promise<void> {
    const autostart = (this.config.get<string>('APS_AUTOSTART') ?? 'true') !== 'false';
    if (!autostart) {
      this.logger.log('APS autostart disabled (APS_AUTOSTART=false).');
      return;
    }
    if (!isInstalled()) {
      this.logger.warn('APS runtime not installed — run `pnpm aps:setup`. Engine will not start.');
      return;
    }
    // Don't block the API boot — start the engine in the background, best-effort.
    void this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  /** True when we own a live engine child process in THIS Pulsar process. */
  isManaged(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /**
   * Best-effort spawn. If an engine already answers on the port (dev `--watch`
   * restart, or a manually-launched instance), we reuse it instead of fighting
   * over the port. Never throws.
   */
  async start(): Promise<void> {
    if (this.isManaged() || this.starting) return;
    this.starting = true;
    try {
      // Reuse an already-running engine (idempotent across hot reloads).
      const alive = await this.client
        .health()
        .then(() => true)
        .catch(() => false);
      if (alive) {
        this.logger.log(`APS engine already responding on :${this.port()} — reusing it.`);
        return;
      }

      const port = this.port();
      this.logger.log(`Starting APS engine (uvicorn) on 127.0.0.1:${port} ...`);
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(
          venvPython(),
          ['-m', 'uvicorn', 'planiadvance_v2.api.main:app', '--host', '127.0.0.1', '--port', port],
          { stdio: ['pipe', 'pipe', 'pipe'], cwd: apsDir(), env: { ...process.env } },
        ) as ChildProcessWithoutNullStreams;
      } catch (err) {
        this.logger.warn(`Failed to spawn APS engine: ${err instanceof Error ? err.message : err}`);
        return;
      }
      this.child = child;
      child.stderr.on('data', (c: Buffer | string) => {
        const s = typeof c === 'string' ? c : c.toString('utf8');
        this.stderrTail.push(s);
        if (this.stderrTail.length > 50) this.stderrTail.shift();
      });
      child.on('exit', (code, signal) => {
        if (this.child === child) this.child = null;
        if (signal !== 'SIGTERM' && code !== 0) {
          this.logger.error(
            `APS engine exited unexpectedly (code=${code} signal=${signal}). stderr tail:\n` +
              this.stderrTail.join('').split(/\r?\n/).filter(Boolean).slice(-20).join('\n'),
          );
        }
      });

      const healthy = await this.waitForHealthy(30_000);
      if (healthy) {
        this.logger.log(`APS engine is up on :${port}.`);
      } else {
        this.logger.warn(
          'APS engine did not become healthy within 30s — calls will 503 until it recovers.',
        );
      }
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    if (this.child && this.child.exitCode === null) {
      this.child.kill();
    }
    this.child = null;
  }

  /** Polls the engine's /health until ready or the deadline elapses. */
  async waitForHealthy(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.client
        .health()
        .then(() => true)
        .catch(() => false);
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  /**
   * A consolidated status view for the diagnostics endpoint. Never throws.
   */
  async status(): Promise<{
    installed: boolean;
    managed: boolean;
    healthy: boolean;
    dbReady: boolean;
    port: string;
  }> {
    const installed = isInstalled();
    const health = await this.client
      .ready()
      .then((r) => ({ healthy: true, dbReady: r.db_ready }))
      .catch(() => ({ healthy: false, dbReady: false }));
    return {
      installed,
      managed: this.isManaged(),
      healthy: health.healthy,
      dbReady: health.dbReady,
      port: this.port(),
    };
  }
}
