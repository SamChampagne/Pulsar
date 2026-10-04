import { writable } from 'svelte/store';
export interface AssistantDraftRequest { tenantId: string; userId: string; title: string; prompt: string; }
/** In-memory, identity-scoped handoff. Never sends a message, uploads data or selects autonomy. */
export const assistantDraft = writable<AssistantDraftRequest | null>(null);
export function requestAssistantDraft(request: AssistantDraftRequest) {
  if (!request.tenantId || !request.userId || !request.prompt.trim() || request.prompt.length > 12000) return false;
  assistantDraft.set({ ...request, title: request.title.slice(0, 120) });
  return true;
}
