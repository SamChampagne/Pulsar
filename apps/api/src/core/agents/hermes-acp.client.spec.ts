import { HermesAcpClient, type AcpEvent } from './hermes-acp.client';
import { FakeAcpServer } from '../../../test/support/fake-acp-server';

describe('HermesAcpClient (ACP over injectable transport)', () => {
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

  it('resumes an existing session by id (session/resume)', async () => {
    const fake = new FakeAcpServer();
    const client = new HermesAcpClient(fake.clientTransport);

    await client.initialize();
    const { sessionId } = await client.resumeSession({ cwd: '.' }, 'prior-session-123');

    expect(fake.lastResume).toBe('prior-session-123');
    expect(sessionId).toBe('prior-session-123');
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

    expect(events.map((e) => e.type)).toEqual(['text', 'tool_call', 'end']);

    const text = events.find((e) => e.type === 'text') as Extract<AcpEvent, { type: 'text' }>;
    expect(text.text).toBe('Bonjour');

    const tool = events.find((e) => e.type === 'tool_call') as Extract<
      AcpEvent,
      { type: 'tool_call' }
    >;
    expect(tool.name).toBe('get_load');
    expect(tool.args).toEqual({ loadId: 'L1' });
  });

  it('auto-allows a reverse request_permission during a prompt turn', async () => {
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
    // ...and the client replied with an "allow_once" selection.
    expect(fake.permissionOutcome).toEqual({ outcome: 'selected', optionId: 'allow_once' });
  });
});
