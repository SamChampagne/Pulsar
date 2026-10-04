import { describe, expect, it, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { assistantDraft, requestAssistantDraft } from './assistant-draft';
afterEach(() => assistantDraft.set(null));
describe('assistant draft handoff', () => {
  it('keeps an identity-scoped draft in memory, without a conversation or send operation', () => {
    expect(requestAssistantDraft({ tenantId: 't', userId: 'u', title: 'Tournée', prompt: 'Lire les incidents.' })).toBe(true);
    expect(get(assistantDraft)).toEqual({ tenantId: 't', userId: 'u', title: 'Tournée', prompt: 'Lire les incidents.' });
  });
  it('rejects missing identity and oversized prompt', () => {
    expect(requestAssistantDraft({ tenantId: '', userId: 'u', title: '', prompt: 'a' })).toBe(false);
    expect(requestAssistantDraft({ tenantId: 't', userId: 'u', title: '', prompt: 'a'.repeat(12001) })).toBe(false);
    expect(get(assistantDraft)).toBeNull();
  });
});
