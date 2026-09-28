import { beforeEach, describe, expect, it } from 'vitest';
import {
  readProductionIntent,
  rememberProductionIntent,
  type ProductionIntent,
} from './production-intent';
const request: ProductionIntent = {
  operationKey: 'af8e7491-213e-4449-8178-2aceb0778f77',
  expectedUpdatedAt: '2026-09-25T00:00:00Z',
  goodQuantity: 2,
  scrapQuantity: 1,
  toBinId: 'bin',
  outputLotId: 'finished',
  note: 'Contrôle atelier',
  consumptions: [{ itemId: 'raw', fromBinId: 'bin', quantity: '1.625', lotId: 'source' }],
};
describe('Production intentions', () => {
  beforeEach(() => localStorage.clear());
  it('preserves exact input/output lots and rejects overwriting a pending request', () => {
    rememberProductionIntent('tenant:user:order', request);
    expect(readProductionIntent('tenant:user:order')).toEqual(request);
    expect(readProductionIntent('tenant:other:order')).toBeNull();
    expect(() =>
      rememberProductionIntent('tenant:user:order', { ...request, outputLotId: 'other' }),
    ).toThrow();
  });
  it('accepts the historical untracked payload without adding a property', () => {
    const { outputLotId, ...old } = request;
    const legacy = { ...old, consumptions: [{ itemId: 'raw', fromBinId: 'bin', quantity: '0' }] };
    rememberProductionIntent('old', legacy);
    expect(readProductionIntent('old')).toEqual(legacy);
  });
  it('fails closed on corrupt, null or impossible lots', () => {
    for (const p of [
      { ...request, outputLotId: null },
      { ...request, goodQuantity: 0 },
      { ...request, consumptions: [{ ...request.consumptions[0], quantity: '0' }] },
      { ...request, consumptions: [{ ...request.consumptions[0], lotId: '' }] },
      { ...request, goodQuantity: 1.5 },
    ]) {
      localStorage.setItem('bad', JSON.stringify(p));
      expect(() => readProductionIntent('bad')).toThrow();
    }
  });
});
