import { EventEmitter } from 'node:events';
import { AgentRuntimeService } from './agent-runtime.service';

describe('AgentRuntimeService runtime-only safety', () => {
  function setup() {
    const cfg = {
      get: jest.fn().mockResolvedValue({ updatedAt: new Date(0) }),
      markTested: jest.fn(),
    };
    const svc = new AgentRuntimeService(
      { mintSessionToken: () => 'session-token' } as never,
      cfg as never,
    );
    const child = Object.assign(new EventEmitter(), { kill: jest.fn() });
    const client = {
      newSession: jest.fn().mockResolvedValue({ sessionId: 's1', models: [] }),
      resumeSession: jest.fn(),
      setModel: jest.fn(),
      closeSession: jest.fn().mockResolvedValue(undefined),
      prompt: jest.fn(),
      cancel: jest.fn(),
    };
    jest.spyOn(svc as never, 'spawnRuntime' as never).mockResolvedValue({
      child,
      client,
      defaultModel: 'model',
      cwd: '/tenant/workspace',
      configVersion: new Date(0),
    } as never);
    return { svc, child, client, cfg };
  }
  const input = {
    tenantId: 't1',
    agent: { id: 'a1', model: null, persona: null },
    pulsarMcpUrl: 'http://local/mcp',
  };
  it('bounds a stalled turn and kills only its child, reporting TIMEOUT not success', async () => {
    const { svc, child, client } = setup();
    Object.assign(svc, { turnTimeoutMs: 10 });
    client.prompt.mockReturnValue({
      next: () => new Promise(() => {}),
      return: async () => ({ done: true }),
    });
    await svc.openSession(input);
    const events = [];
    for await (const event of svc.sendTurn('s1', 'go')) events.push(event);
    expect(events.find((e) => e.type === 'result')).toMatchObject({
      result: { status: 'failed', code: 'TIMEOUT' },
    });
    expect(client.cancel).toHaveBeenCalledWith('s1');
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(svc.isLive('s1')).toBe(false);
  });
  it('uses the tenant workspace, selected model and governed MCP then forgets a dead child', async () => {
    const { svc, child, client } = setup();
    expect(await svc.openSession(input)).toBe('s1');
    expect(client.newSession.mock.calls[0][0].cwd).toBe('/tenant/workspace');
    expect(client.newSession.mock.calls[0][0].mcpServers[0].name).toBe('pulsar');
    expect(client.setModel).toHaveBeenCalledWith('s1', 'model');
    expect(svc.isLive('s1')).toBe(true);
    child.emit('close');
    expect(svc.isLive('s1')).toBe(false);
  });
  it('releases a remote process after each completed turn for strict resume next time', async () => {
    const prior = process.env.AGENT_RUNTIME_MODE;
    process.env.AGENT_RUNTIME_MODE = 'remote';
    try {
      const { svc, child, client } = setup();
      client.prompt.mockReturnValue(
        (async function* () {
          yield { type: 'end' };
        })(),
      );
      await svc.openSession(input);
      for await (const _event of svc.sendTurn('s1', 'hello')) {
        /* drain */
      }
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(svc.isLive('s1')).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.AGENT_RUNTIME_MODE;
      else process.env.AGENT_RUNTIME_MODE = prior;
    }
  });
  it('does not silently fall back when the selected model fails', async () => {
    const { svc, child, client } = setup();
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    client.setModel.mockRejectedValue(new Error('private provider error'));
    await expect(svc.openSession(input)).rejects.toThrow('Session Hermes indisponible');
    expect(child.kill).toHaveBeenCalled();
    expect(svc.isLive('s1')).toBe(false);
    log.mockRestore();
  });
  it('runtime verification never prompts the model and cannot claim inference', async () => {
    const { svc, child, client, cfg } = setup();
    expect(await svc.testConnection('t1')).toEqual({ ok: true, scope: 'RUNTIME_ONLY', models: [] });
    expect(client.prompt).not.toHaveBeenCalled();
    expect(client.newSession).toHaveBeenCalledWith({ cwd: '/tenant/workspace', mcpServers: [] });
    expect(cfg.markTested).toHaveBeenCalledWith('t1', true, [], new Date(0));
    expect(child.kill).toHaveBeenCalled();
  });

  it('kills a failed history load without opening a replacement or sending a prompt', async () => {
    const { svc, child, client } = setup();
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    client.resumeSession.mockRejectedValue(new Error('Session history unavailable'));
    try {
      await expect(svc.resumeSession({ ...input, existingSessionId: 'missing' })).rejects.toThrow(
        'Reprise Hermes indisponible',
      );
      expect(child.kill).toHaveBeenCalled();
      expect(client.newSession).not.toHaveBeenCalled();
      expect(client.setModel).not.toHaveBeenCalled();
      expect(client.prompt).not.toHaveBeenCalled();
      expect(svc.isLive('missing')).toBe(false);
    } finally {
      log.mockRestore();
    }
  });
});
