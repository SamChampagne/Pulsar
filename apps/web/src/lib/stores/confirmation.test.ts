import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  answerConfirmation,
  cancelConfirmation,
  confirmAction,
  confirmation,
} from './confirmation';

afterEach(cancelConfirmation);

describe('confirmation decisions', () => {
  it('requires an explicit answer and settles only once', async () => {
    const result = confirmAction('Supprimer le brouillon ?');
    const request = get(confirmation)!;
    expect(request.message).toBe('Supprimer le brouillon ?');
    answerConfirmation(request.id, true);
    answerConfirmation(request.id, false);
    await expect(result).resolves.toBe(true);
    expect(get(confirmation)).toBeNull();
  });

  it('cancels a superseded request and ignores its stale answer', async () => {
    const first = confirmAction('Ancienne action');
    const oldId = get(confirmation)!.id;
    const second = confirmAction('Action courante', { dangerous: false });
    await expect(first).resolves.toBe(false);
    answerConfirmation(oldId, true);
    expect(get(confirmation)?.message).toBe('Action courante');
    expect(get(confirmation)?.dangerous).toBe(false);
    cancelConfirmation();
    await expect(second).resolves.toBe(false);
  });

  it('fails closed when navigation or unmount cancels the dialog', async () => {
    const result = confirmAction('Action en attente');
    cancelConfirmation();
    cancelConfirmation();
    await expect(result).resolves.toBe(false);
    expect(get(confirmation)).toBeNull();
  });
});
