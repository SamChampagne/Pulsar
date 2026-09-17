import { describe, it, expect } from 'vitest';
import {
  checkWebhookUrl,
  isSafeWebhookUrl,
  LEGACY_WEBHOOK_EVENTS,
  resolveWebhookTarget,
} from './webhook-target';

describe('resolveWebhookTarget', () => {
  it('reads the outbox spelling (url / secret)', () => {
    expect(resolveWebhookTarget({ url: 'https://a.example.com', secret: 's1' })).toEqual({
      url: 'https://a.example.com',
      secret: 's1',
    });
  });

  it('reads the studio spelling (endpointUrl / webhookSecret)', () => {
    expect(
      resolveWebhookTarget({ endpointUrl: 'https://b.example.com', webhookSecret: 's2' }),
    ).toEqual({ url: 'https://b.example.com', secret: 's2' });
  });

  it('prefers url/secret when both spellings are present', () => {
    expect(
      resolveWebhookTarget({
        url: 'https://a.example.com',
        endpointUrl: 'https://b.example.com',
        secret: 's1',
        webhookSecret: 's2',
      }),
    ).toEqual({ url: 'https://a.example.com', secret: 's1' });
  });

  it('omits the secret when none is configured and trims values', () => {
    expect(resolveWebhookTarget({ url: '  https://a.example.com  ' })).toEqual({
      url: 'https://a.example.com',
    });
  });

  it('returns null without a URL', () => {
    expect(resolveWebhookTarget({})).toBeNull();
    expect(resolveWebhookTarget({ url: '   ' })).toBeNull();
    expect(resolveWebhookTarget(null)).toBeNull();
    expect(resolveWebhookTarget('nope')).toBeNull();
  });
});

describe('checkWebhookUrl (egress guard)', () => {
  it('accepts public http/https endpoints', () => {
    expect(isSafeWebhookUrl('https://hooks.slack.com/services/x')).toBe(true);
    expect(isSafeWebhookUrl('http://example.com:8080/in')).toBe(true);
  });

  it('refuses non-http schemes', () => {
    expect(checkWebhookUrl('file:///etc/passwd')).toEqual({
      ok: false,
      reason: expect.stringContaining('http/https'),
    });
    expect(isSafeWebhookUrl('ftp://example.com')).toBe(false);
    expect(isSafeWebhookUrl('pas une url')).toBe(false);
  });

  it('refuses loopback, link-local and private ranges', () => {
    for (const url of [
      'http://localhost:3000/h',
      'http://app.localhost/h',
      'http://127.0.0.1/h',
      'http://10.0.0.5/h',
      'http://192.168.1.10/h',
      'http://172.16.0.1/h',
      'http://172.31.255.1/h',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0/h',
      'http://[::1]/h',
      'http://[fd12:3456::1]/h',
      'http://[fe80::1]/h',
    ]) {
      expect(isSafeWebhookUrl(url)).toBe(false);
    }
  });

  it('keeps public addresses adjacent to private ranges', () => {
    expect(isSafeWebhookUrl('http://172.15.0.1/h')).toBe(true);
    expect(isSafeWebhookUrl('http://172.32.0.1/h')).toBe(true);
    expect(isSafeWebhookUrl('http://11.0.0.1/h')).toBe(true);
  });

  it('allows private hosts when explicitly opted in (dev/CI)', () => {
    expect(isSafeWebhookUrl('http://127.0.0.1:4000/hook', { allowPrivate: true })).toBe(true);
    // The scheme rule still applies with the escape hatch on.
    expect(isSafeWebhookUrl('file:///tmp/x', { allowPrivate: true })).toBe(false);
  });

  it('strips a trailing DNS root dot before comparing (SSRF bypass)', () => {
    expect(isSafeWebhookUrl('http://localhost./h')).toBe(false);
    expect(isSafeWebhookUrl('http://foo.localhost./x')).toBe(false);
    expect(isSafeWebhookUrl('http://127.0.0.1./x')).toBe(false);
    // A genuinely public host with a trailing root dot is still allowed.
    expect(isSafeWebhookUrl('https://hooks.example.com./x')).toBe(true);
  });

  it('unwraps IPv4-mapped/compatible/NAT64 IPv6 literals and refuses a private embedded address', () => {
    for (const url of [
      'http://[::ffff:127.0.0.1]/x', // IPv4-mapped loopback
      'http://[::ffff:169.254.169.254]/x', // IPv4-mapped cloud metadata IP
      'http://[::127.0.0.1]/x', // IPv4-compatible loopback
      'http://[64:ff9b::7f00:1]/x', // NAT64 well-known prefix wrapping 127.0.0.1
    ]) {
      expect(isSafeWebhookUrl(url)).toBe(false);
    }
  });

  it('refuses localhost.localdomain and the 100.64.0.0/10 CGNAT range', () => {
    expect(isSafeWebhookUrl('http://localhost.localdomain/x')).toBe(false);
    expect(isSafeWebhookUrl('http://100.64.0.1/x')).toBe(false);
    expect(isSafeWebhookUrl('http://100.127.255.255/x')).toBe(false);
    // Adjacent public ranges stay allowed.
    expect(isSafeWebhookUrl('http://100.63.0.1/x')).toBe(true);
    expect(isSafeWebhookUrl('http://100.128.0.1/x')).toBe(true);
  });

  it('still allows a genuinely public IPv6/IPv4 address, including a mapped public one', () => {
    expect(isSafeWebhookUrl('https://[2606:4700::6810:84e5]/x')).toBe(true);
    expect(isSafeWebhookUrl('https://8.8.8.8/x')).toBe(true);
    expect(isSafeWebhookUrl('http://[::ffff:8.8.8.8]/x')).toBe(true);
  });
});

describe('LEGACY_WEBHOOK_EVENTS', () => {
  it('lists the 6 TMS events an empty allowlist used to mean', () => {
    expect([...LEGACY_WEBHOOK_EVENTS].sort()).toEqual(
      [
        'load.completed',
        'load.dispatched',
        'tender.accepted',
        'tender.declined',
        'tender.expired',
        'tender.sent',
      ].sort(),
    );
  });
});
