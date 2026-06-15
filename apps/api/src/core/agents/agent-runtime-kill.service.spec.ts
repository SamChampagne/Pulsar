import { AgentRuntimeService } from './agent-runtime.service';

describe('AgentRuntimeService.killAgentSessions', () => {
  it('kills only the target agent\'s live sessions and returns the count', async () => {
    const svc = new AgentRuntimeService({} as never, {} as never);
    const killed: string[] = [];
    const mkSession = (agentId: string, id: string) => ({
      agentId,
      persona: null,
      firstTurnDone: false,
      client: { closeSession: async (s: string) => { killed.push(`close:${s}`); } },
      child: { kill: () => { killed.push(`kill:${id}`); } },
    });
    // Reach into the private live map (test-only).
    const live = (svc as unknown as { live: Map<string, unknown> }).live;
    live.set('s1', mkSession('a1', 's1'));
    live.set('s2', mkSession('a1', 's2'));
    live.set('s3', mkSession('a2', 's3'));

    const n = await svc.killAgentSessions('a1');

    expect(n).toBe(2);
    expect(killed.sort()).toEqual(['close:s1', 'close:s2', 'kill:s1', 'kill:s2'].sort());
    expect(live.has('s1')).toBe(false);
    expect(live.has('s2')).toBe(false);
    expect(live.has('s3')).toBe(true); // other agent untouched
  });
});
