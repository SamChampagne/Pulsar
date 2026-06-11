import { maskConfig, mergePreservingMasked } from './integrations.service';

describe('integration config masking', () => {
  it('masks sensitive keys, keeps the rest', () => {
    expect(maskConfig({ url: 'https://x', secret: 's3cret', apiToken: 't' })).toEqual({
      url: 'https://x',
      secret: '***',
      apiToken: '***',
    });
  });

  it('keeps empty sensitive values untouched (no fake ***)', () => {
    expect(maskConfig({ secret: '' })).toEqual({ secret: '' });
  });

  it('mergePreservingMasked keeps the stored secret when the client sends ***', () => {
    const stored = { url: 'https://old', secret: 's3cret' };
    const incoming = { url: 'https://new', secret: '***' };
    expect(mergePreservingMasked(incoming, stored)).toEqual({
      url: 'https://new',
      secret: 's3cret',
    });
  });
});
