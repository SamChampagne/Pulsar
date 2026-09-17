import { redactTokenPath } from './request-logging.interceptor';

describe('redactTokenPath', () => {
  it('redacts the inbound webhook token', () => {
    expect(redactTokenPath('/api/v1/public/hooks/abc123SECRETtoken')).toBe(
      '/api/v1/public/hooks/<redacted>',
    );
  });

  it('redacts the portal token but keeps the rest of the path', () => {
    expect(redactTokenPath('/api/v1/public/portal/tok_abc/orders')).toBe(
      '/api/v1/public/portal/<redacted>/orders',
    );
    expect(redactTokenPath('/api/v1/public/portal/tok_abc/shipments/shp_1/documents')).toBe(
      '/api/v1/public/portal/<redacted>/shipments/shp_1/documents',
    );
  });

  it('redacts driver, tender, tracking, carrier-portal, rfp and unsubscribe tokens', () => {
    expect(redactTokenPath('/api/v1/public/driver/dtok/pod')).toBe(
      '/api/v1/public/driver/<redacted>/pod',
    );
    expect(redactTokenPath('/api/v1/public/tenders/ttok/accept')).toBe(
      '/api/v1/public/tenders/<redacted>/accept',
    );
    expect(redactTokenPath('/api/v1/public/tracking/trk')).toBe(
      '/api/v1/public/tracking/<redacted>',
    );
    expect(redactTokenPath('/api/v1/public/carrier-portal/ctok/loads')).toBe(
      '/api/v1/public/carrier-portal/<redacted>/loads',
    );
    expect(redactTokenPath('/api/v1/public/rfp-invites/itok')).toBe(
      '/api/v1/public/rfp-invites/<redacted>',
    );
    expect(redactTokenPath('/api/v1/public/crm/unsubscribe/utok')).toBe(
      '/api/v1/public/crm/unsubscribe/<redacted>',
    );
  });

  it('leaves ordinary paths untouched', () => {
    for (const path of [
      '/api/v1/transportation/loads/ld_1',
      '/api/v1/public/sites/mon-site',
      '/api/v1/integrations/int_1/inbound-token',
      '/api/v1/portal/auth/login',
    ]) {
      expect(redactTokenPath(path)).toBe(path);
    }
  });

  it('never throws on degenerate input', () => {
    expect(redactTokenPath('')).toBe('');
    // Trailing slash: there is no token segment to redact.
    expect(redactTokenPath('/api/v1/public/hooks/')).toBe('/api/v1/public/hooks/');
  });
});
