import { HermesAcpClient, type AcpEvent } from './hermes-acp.client';
import { FakeAcpServer } from '../../../test/support/fake-acp-server';
import { Readable, PassThrough } from 'node:stream';

describe('HermesAcpClient (ACP over injectable transport)', () => {
  it('preserves UTF-8 characters split across remote stream chunks', async () => {
    const raw = Buffer.from('{"text":"é 🚚"}\n');
    const offset = raw.indexOf(Buffer.from('🚚')) + 2;
    const transport = HermesAcpClient.stdioTransport({
      stdin: new PassThrough(),
      stdout: Readable.from([raw.subarray(0, offset), raw.subarray(offset)]),
    });
    const frames = [];
    for await (const frame of transport.messages) frames.push(frame);
    expect(frames).toEqual([{ text: 'é 🚚' }]);
  });
  it.each([
    [null, 'end_turn', 'failed'],
    [
      { version: 1, status: 'failed', code: 'RUNTIME_FAILURE', error: 'secret' },
      'refusal',
      'failed',
    ],
    [{ version: 1, status: 'succeeded' }, 'cancelled', 'cancelled'],
    [{ version: 1, status: 'succeeded' }, 'max_tokens', 'failed'],
  ])(
    'projects a terminal outcome without guessing from prose',
    async (outcome, stopReason, status) => {
      const fake = new FakeAcpServer();
      fake.script = { outcome, stopReason: String(stopReason) };
      const client = new HermesAcpClient(fake.clientTransport);
      const events: AcpEvent[] = [];
      for await (const ev of client.prompt('s', 'go')) events.push(ev);
      expect(events.find((e) => e.type === 'result')).toMatchObject({ result: { status } });
      expect(JSON.stringify(events)).not.toContain('secret');
      expect(events.at(-1)?.type).toBe('end');
    },
  );
  it('initializes, opens a model-less session with mcpServers, and returns a sessionId', async () => {
    const fake = new FakeAcpServer();
    const client = new HermesAcpClient(fake.clientTransport);

    await client.initialize();

    const { sessionId } = await client.newSession({
      cwd: '.',
      mcpServers: [
        {
          type: 'http',
          name: 'pulsar',
          url: 'http://x/api/v1/mcp',
          headers: [{ name: 'X-Agent-Key', value: 'as_x' }],
        },
      ],
    });

    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);

    // The fake recorded a session with cwd + the exact mcpServers entry, and no model.
    expect(fake.lastNewSession?.cwd).toBe('.');
    expect(fake.lastNewSession?.mcpServers).toEqual([
      {
        type: 'http',
        name: 'pulsar',
        url: 'http://x/api/v1/mcp',
        headers: [{ name: 'X-Agent-Key', value: 'as_x' }],
      },
    ]);
    expect(fake.lastModel).toBeNull();
  });

  it('returns a cleaned model list from session/new (drops the doubled-prefix current entry)', async () => {
    const fake = new FakeAcpServer();
    const client = new HermesAcpClient(fake.clientTransport);

    await client.initialize();
    const { models } = await client.newSession({ cwd: '.' });

    expect(models).toEqual([
      { value: 'anthropic:claude-sonnet-4-6', label: 'claude-sonnet-4-6' },
      { value: 'anthropic:claude-opus-4-8', label: 'claude-opus-4-8' },
    ]);
  });

  it('resumes existing history using strict session/load, preserving its id', async () => {
    const fake = new FakeAcpServer();
    const client = new HermesAcpClient(fake.clientTransport);

    await client.initialize();
    const { sessionId } = await client.resumeSession({ cwd: '.' }, 'prior-session-123');

    expect(fake.lastResume).toBe('prior-session-123');
    expect(sessionId).toBe('prior-session-123');
  });

  it('refuses a missing history instead of claiming a fresh conversation was resumed', async () => {
    const fake = new FakeAcpServer();
    fake.loadResult = null;
    const client = new HermesAcpClient(fake.clientTransport);
    await expect(client.resumeSession({ cwd: '.' }, 'missing')).rejects.toThrow(
      'history unavailable',
    );
  });

  it('sends cancellation as a notification without waiting for a reply', async () => {
    const fake = new FakeAcpServer();
    const client = new HermesAcpClient(fake.clientTransport);
    client.cancel('running-session');
    expect(fake.lastCancel).toBe('running-session');
  });

  it('rejects subsequent calls after normal EOF rather than leaving them pending', async () => {
    const fake = new FakeAcpServer();
    const client = new HermesAcpClient(fake.clientTransport);
    await client.initialize();
    fake.close();
    await new Promise((resolve) => setImmediate(resolve));
    await expect(client.newSession({ cwd: '.' })).rejects.toThrow('transport closed');
    expect(() => client.cancel('closed')).toThrow('transport closed');
  });

  it('rejects a synchronous write failure without retaining a pending call', async () => {
    const client = new HermesAcpClient({
      send: () => {
        throw new Error('pipe closed');
      },
      messages: {
        async *[Symbol.asyncIterator]() {
          /* EOF */
        },
      },
    });
    await expect(client.initialize()).rejects.toThrow('pipe closed');
  });

  it('sets the model after the session is created', async () => {
    const fake = new FakeAcpServer();
    const client = new HermesAcpClient(fake.clientTransport);

    await client.initialize();
    const { sessionId } = await client.newSession({ cwd: '.' });

    await client.setModel(sessionId, 'anthropic:claude-sonnet-4-6');

    expect(fake.lastModel).toBe('anthropic:claude-sonnet-4-6');
  });

  it('streams a prompt turn as text + tool_call events, then end', async () => {
    const fake = new FakeAcpServer();
    fake.script = {
      assistantText: 'Bonjour',
      toolCall: { name: 'get_load', args: { loadId: 'L1' } },
    };
    const client = new HermesAcpClient(fake.clientTransport);

    await client.initialize();
    const { sessionId } = await client.newSession({ cwd: '.' });

    const events: AcpEvent[] = [];
    for await (const ev of client.prompt(sessionId, '?')) {
      events.push(ev);
    }

    expect(events.map((e) => e.type)).toEqual(['text', 'tool_call', 'result', 'end']);

    const text = events.find((e) => e.type === 'text') as Extract<AcpEvent, { type: 'text' }>;
    expect(text.text).toBe('Bonjour');

    const tool = events.find((e) => e.type === 'tool_call') as Extract<
      AcpEvent,
      { type: 'tool_call' }
    >;
    expect(tool.name).toBe('get_load');
    expect(tool.args).toEqual({ loadId: 'L1' });
  });

  it('rejects host privileges independently of Pulsar business approvals', async () => {
    const fake = new FakeAcpServer();
    fake.script = { assistantText: 'ok', requestPermission: true };
    const client = new HermesAcpClient(fake.clientTransport);

    await client.initialize();
    const { sessionId } = await client.newSession({ cwd: '.' });

    const events: AcpEvent[] = [];
    for await (const ev of client.prompt(sessionId, 'go')) {
      events.push(ev);
    }

    // The turn still completes...
    expect(events[events.length - 1].type).toBe('end');
    expect(fake.permissionOutcome).toEqual({ outcome: 'selected', optionId: 'deny' });
  });

  it('cancels when the host offers only allow options (never picks the first)', async () => {
    const fake = new FakeAcpServer();
    fake.script = {
      requestPermission: true,
      permissionOptions: [{ optionId: 'allow', kind: 'allow_always' }],
    };
    const client = new HermesAcpClient(fake.clientTransport);
    await client.initialize();
    const { sessionId } = await client.newSession({ cwd: '.' });
    for await (const _ of client.prompt(sessionId, 'go')) {
      /* consume */
    }
    expect(fake.permissionOutcome).toEqual({ outcome: 'cancelled' });
  });

  it('fails closed on an incompatible ACP protocol', async () => {
    const fake = new FakeAcpServer();
    fake.protocolVersion = 999;
    await expect(new HermesAcpClient(fake.clientTransport).initialize()).rejects.toThrow(
      'incompatible',
    );
  });
});
