import { beforeEach, expect, it } from 'vitest';
import { readReversalIntent, rememberReversalIntent } from './reversal-intent';
const request = {
  declarationId: 'decl',
  body: {
    operationKey: 'af8e7491-213e-4449-8178-2aceb0778f77',
    expectedUpdatedAt: '2026-09-25T00:00:00Z',
    reviewToken: 'a'.repeat(64),
    reason: 'Erreur de saisie',
  },
};
beforeEach(() => localStorage.clear());
it('keeps the exact reviewed correction scoped and never overwrites it', () => {
  rememberReversalIntent('tenant:user:order', request);
  expect(readReversalIntent('tenant:user:order')).toEqual(request);
  expect(readReversalIntent('tenant:other:order')).toBeNull();
  expect(() =>
    rememberReversalIntent('tenant:user:order', { ...request, declarationId: 'other' }),
  ).toThrow();
});
it('fails closed on corrupt or invalid correction intentions', () => {
  for (const data of [
    null,
    {},
    { ...request, body: { ...request.body, reviewToken: null } },
    { ...request, body: { ...request.body, reason: ' ' } },
  ]) {
    localStorage.setItem('bad', JSON.stringify(data));
    expect(() => readReversalIntent('bad')).toThrow();
  }
});
