import { describe, it, expect } from 'vitest';
import { PARTY_WORKSPACE_SOURCES, partyWorkspaceHref } from './party-workspace';
import { PERMISSION_CATALOG } from './permissions';

describe('Party workspace contract', () => {
  it('has unique explicit document grants, never master-data or manage grants', () => {
    expect(new Set(PARTY_WORKSPACE_SOURCES.map((s) => s.key)).size).toBe(8);
    for (const s of PARTY_WORKSPACE_SOURCES) {
      expect(PERMISSION_CATALOG.some((p) => p.key === s.permission)).toBe(true);
      expect(s.permission).toMatch(/\.read$/);
      expect(s.permission).not.toContain('master-data');
    }
  });
  it('links to exact source dossiers and encodes their IDs', () => {
    const urls = PARTY_WORKSPACE_SOURCES.map((s) => partyWorkspaceHref(s.key, 'id/&?'));
    expect(new Set(urls).size).toBe(8);
    for (const href of urls) expect(href).toContain('id%2F%26%3F');
    expect(partyWorkspaceHref('customer-invoice', 'invoice')).toBe('/invoices?statement=invoice');
    expect(partyWorkspaceHref('service-job', 'job')).toBe('/services/interventions?jobId=job');
  });
});
