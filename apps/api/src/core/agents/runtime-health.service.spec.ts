import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isInstalled } from './runtime-install';
import { RuntimeHealthService, RUNTIME_REFERENCE } from './runtime-health.service';
jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('node:fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('./runtime-install', () => ({
  isInstalled: jest.fn(),
  repoRoot: () => '/repo',
  venvPython: () => '/python',
}));

describe('RuntimeHealthService local-only inventory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isInstalled as jest.Mock).mockReturnValue(true);
    (readFile as jest.Mock).mockResolvedValue('version = "0.16.0"');
    (execFile as unknown as jest.Mock).mockImplementation((command, args, _options, cb) => {
      cb(
        null,
        command === '/python'
          ? JSON.stringify({
              python: '3.12.13',
              'hermes-agent': '0.16.0',
              'agent-client-protocol': '0.9.0',
              mcp: '1.26.0',
            })
          : args.includes('rev-parse')
            ? RUNTIME_REFERENCE.commit
            : '',
      );
    });
  });
  it('identifies the pinned fork without claiming provider/model validation', async () => {
    const result = await new RuntimeHealthService().inspect();
    expect(result.assessment).toBe('reference-match');
    expect(result.scope).toBe('LOCAL_METADATA_ONLY');
    expect(result.reference.upstreamVersion).toBe('0.21.5');
    expect(JSON.stringify(result)).not.toMatch(/apiKey|DATABASE|\/repo|\/python/);
  });
  it('coalesces concurrent inspections and caches the result', async () => {
    const svc = new RuntimeHealthService();
    await Promise.all([svc.inspect(), svc.inspect()]);
    await svc.inspect();
    expect(execFile).toHaveBeenCalledTimes(3);
  });
  it('reports unavailable metadata as unknown, never current or healthy', async () => {
    (execFile as unknown as jest.Mock).mockImplementation((_c, _a, _o, cb) =>
      cb(new Error('SECRET PATH')),
    );
    const result = await new RuntimeHealthService().inspect();
    expect(result.assessment).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('does not execute Python when uninstalled', async () => {
    (isInstalled as jest.Mock).mockReturnValue(false);
    expect((await new RuntimeHealthService().inspect()).assessment).toBe('not-installed');
    expect((execFile as unknown as jest.Mock).mock.calls.every((c) => c[0] === 'git')).toBe(true);
  });
  it('flags mismatched source versions for review', async () => {
    (readFile as jest.Mock).mockResolvedValue('version = "0.21.5"');
    expect((await new RuntimeHealthService().inspect()).assessment).toBe('review-required');
  });
  it('bounds execution and does not inherit provider/server secrets', async () => {
    await new RuntimeHealthService().inspect();
    for (const [_cmd, _args, opts] of (execFile as unknown as jest.Mock).mock.calls) {
      expect(opts.timeout).toBe(5000);
      expect(opts.windowsHide).toBe(true);
      expect(opts.env.DATABASE_URL).toBeUndefined();
      expect(opts.env.OPENAI_API_KEY).toBeUndefined();
    }
  });
});
