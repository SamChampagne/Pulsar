import { AgentConversationsController } from './agent-conversations.controller';
import type { AcpEvent } from './hermes-acp.client';

describe('Conversation terminal outcomes', () => {
  function setup(events: AcpEvent[]) {
    const conversations = {
      assertOwned: jest.fn().mockResolvedValue({ id: 'c', hermesSessionId: 's' }),
      addMessage: jest.fn(),
      titleFromMessage: jest.fn(),
    };
    const runtime = {
      isLive: () => true,
      sendTurn: async function* () {
        yield* events;
      },
    };
    const frames: string[] = [];
    const res = {
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: (value: string) => frames.push(value),
      end: jest.fn(),
    };
    const controller = new AgentConversationsController(
      { getOwned: jest.fn().mockResolvedValue({ id: 'a', status: 'ACTIVE' }) } as never,
      runtime as never,
      conversations as never,
    );
    return {
      conversations,
      frames,
      res,
      runtime,
      controller,
      execute: () =>
        controller.turn({ tenantId: 't', id: 'u' } as never, 'c', { text: 'hello' }, res as never),
    };
  }
  it.each(['failed', 'cancelled'] as const)(
    'persists a visibly unvalidated response on %s, never raw provider errors',
    async (status) => {
      const h = setup([
        { type: 'text', text: 'partial' },
        { type: 'error', message: 'private-provider-key' },
        { type: 'result', result: { version: 1, status } },
        { type: 'end' },
      ]);
      await h.execute();
      expect(h.conversations.assertOwned).toHaveBeenCalledWith('t', 'u', 'c');
      expect(h.conversations.addMessage.mock.calls[1][2]).toContain('[Réponse non validée]');
      expect(h.frames.join('')).not.toContain('private-provider-key');
      expect(h.frames.join('')).toContain(`"status":"${status}"`);
      expect(h.res.end).toHaveBeenCalled();
    },
  );
  it('does not infer success from end alone', async () => {
    const h = setup([{ type: 'end' }]);
    await h.execute();
    expect(h.frames.join('')).toContain('"status":"failed"');
  });
  it('keeps the partial reply visibly unvalidated even when the stream throws', async () => {
    const h = setup([]);
    h.runtime.sendTurn = async function* () {
      yield { type: 'text', text: 'partial' };
      throw new Error('private-provider-detail');
    };
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await h.execute();
      expect(h.conversations.addMessage.mock.calls[1][2]).toContain('[Réponse non validée]');
      expect(h.conversations.addMessage.mock.calls[1][2]).toContain('partial');
      expect(h.frames.join('')).not.toContain('private-provider-detail');
    } finally {
      log.mockRestore();
    }
  });
  it('persists a confirmed successful reply before reporting completion', async () => {
    const h = setup([
      { type: 'text', text: 'answer' },
      { type: 'result', result: { version: 1, status: 'succeeded' } },
      { type: 'end' },
    ]);
    await h.execute();
    expect(h.conversations.addMessage).toHaveBeenCalledWith('c', 'assistant', 'answer');
    expect(h.frames.join('')).toContain('"status":"succeeded"');
  });
  it('rejects foreign ownership before appending or streaming anything', async () => {
    const h = setup([]);
    h.conversations.assertOwned.mockRejectedValue(new Error('Not your conversation'));
    await expect(h.execute()).rejects.toThrow('Not your');
    expect(h.conversations.addMessage).not.toHaveBeenCalled();
    expect(h.frames).toEqual([]);
  });

  it('refuses concurrent turns on one history, then releases its slot', async () => {
    const h = setup([]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.runtime.sendTurn = async function* () {
      await gate;
      yield { type: 'end' };
    };
    const first = h.execute();
    await expect(h.execute()).rejects.toThrow('déjà en cours');
    release();
    await first;
    await expect(h.execute()).resolves.toBeUndefined();
  });
  it('lets independent conversations progress concurrently', async () => {
    const h = setup([]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.runtime.sendTurn = async function* () {
      await gate;
      yield { type: 'end' };
    };
    const first = h.execute();
    const second = h.controller.turn(
      { tenantId: 't', id: 'u' } as never,
      'other',
      { text: 'next' },
      h.res as never,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.conversations.assertOwned).toHaveBeenCalledWith('t', 'u', 'other');
    release();
    await Promise.all([first, second]);
    expect(h.conversations.addMessage.mock.calls.filter((call) => call[1] === 'user')).toHaveLength(
      2,
    );
  });
});
