/**
 * Client identity for rate limiting: which address a request is charged to.
 *
 * The rule under test: a client can never choose the identity it is charged to. The
 * application only believes a forwarding header when the deployment has declared, in
 * configuration, which proxy wrote it. Anything else falls back to "not identified", which
 * is refused for abuse-sensitive endpoints rather than shared with other callers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache, assertProductionConfig } from '../src/config/env';
import { clientIdentity, normaliseIp } from '../src/server/client-identity';

const SAVED = { ...process.env };

function configure(vars: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
}

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/auth/guest', { method: 'POST', headers });
}

beforeEach(() => {
  configure({ NODE_ENV: 'test', DYNASTY_TRUSTED_PROXY_HOPS: undefined, DYNASTY_CLIENT_IP_HEADER: undefined });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in SAVED)) delete process.env[key];
  Object.assign(process.env, SAVED);
  resetEnvCache();
});

describe('development without a declared proxy', () => {
  it('ignores every forwarding header, so none can move a caller to another bucket', () => {
    const a = clientIdentity(req({ 'x-forwarded-for': '198.51.100.1' }));
    const b = clientIdentity(req({ 'x-forwarded-for': '203.0.113.99', 'x-real-ip': '192.0.2.5' }));
    expect(a).toEqual({ ok: true, key: 'local' });
    expect(b).toEqual({ ok: true, key: 'local' });
  });
});

describe('production without a declared proxy', () => {
  it('refuses to attribute the caller, and does not fall back to a shared identity', () => {
    configure({ NODE_ENV: 'production' });
    const outcome = clientIdentity(req({ 'x-forwarded-for': '198.51.100.1' }));
    expect(outcome).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('reports the missing declaration as a production configuration problem', () => {
    configure({ NODE_ENV: 'production', DYNASTY_APP_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgres://u:p@h/db_disposable' });
    expect(assertProductionConfig().join(' ')).toMatch(/DYNASTY_TRUSTED_PROXY_HOPS or DYNASTY_CLIENT_IP_HEADER/);
  });
});

describe('x-forwarded-for behind a declared proxy (DYNASTY_TRUSTED_PROXY_HOPS=1)', () => {
  beforeEach(() => configure({ DYNASTY_TRUSTED_PROXY_HOPS: '1' }));

  it('charges the address the proxy appended, which is the last entry', () => {
    expect(clientIdentity(req({ 'x-forwarded-for': '203.0.113.7' }))).toEqual({ ok: true, key: 'ip:4:203.0.113.7' });
  });

  it('ignores whatever a client prepends: changing the leftmost entries does not change the bucket', () => {
    const forged = clientIdentity(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 203.0.113.7' }));
    const other = clientIdentity(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }));
    expect(forged).toEqual({ ok: true, key: 'ip:4:203.0.113.7' });
    expect(other).toEqual(forged);
  });

  it('keeps different real clients in different buckets', () => {
    const a = clientIdentity(req({ 'x-forwarded-for': '203.0.113.7' }));
    const b = clientIdentity(req({ 'x-forwarded-for': '198.51.100.9' }));
    expect(a).not.toEqual(b);
  });

  it('refuses a request that arrived without the header (it bypassed the proxy)', () => {
    expect(clientIdentity(req())).toEqual({ ok: false, reason: 'unidentified' });
    expect(clientIdentity(req({ 'x-forwarded-for': '' }))).toEqual({ ok: false, reason: 'unidentified' });
  });

  it('refuses malformed values rather than guessing', () => {
    for (const bad of ['not-an-ip', '203.0.113.7:4000', '999.1.1.1', 'a,,b', '203.0.113.7;drop']) {
      expect(clientIdentity(req({ 'x-forwarded-for': bad })), bad).toEqual({ ok: false, reason: 'unidentified' });
    }
  });

  it('ignores the x-real-ip header entirely when a proxy is declared', () => {
    expect(clientIdentity(req({ 'x-real-ip': '192.0.2.5' }))).toEqual({ ok: false, reason: 'unidentified' });
  });
});

describe('two trusted proxies (DYNASTY_TRUSTED_PROXY_HOPS=2)', () => {
  beforeEach(() => configure({ DYNASTY_TRUSTED_PROXY_HOPS: '2' }));

  it('charges the entry two from the right', () => {
    expect(clientIdentity(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }))).toEqual({ ok: true, key: 'ip:4:203.0.113.7' });
  });

  it('refuses a header with fewer entries than trusted proxies', () => {
    expect(clientIdentity(req({ 'x-forwarded-for': '203.0.113.7' }))).toEqual({ ok: false, reason: 'unidentified' });
  });
});

describe('a single platform header (DYNASTY_CLIENT_IP_HEADER)', () => {
  beforeEach(() => configure({ DYNASTY_CLIENT_IP_HEADER: 'cf-connecting-ip' }));

  it('uses the declared header and ignores x-forwarded-for', () => {
    expect(clientIdentity(req({ 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '1.1.1.1' }))).toEqual({ ok: true, key: 'ip:4:198.51.100.4' });
  });

  it('refuses when the declared header is absent or lists several values', () => {
    expect(clientIdentity(req({ 'x-forwarded-for': '1.1.1.1' }))).toEqual({ ok: false, reason: 'unidentified' });
    expect(clientIdentity(req({ 'cf-connecting-ip': '198.51.100.4, 1.1.1.1' }))).toEqual({ ok: false, reason: 'unidentified' });
  });
});

describe('invalid or ambiguous declarations', () => {
  it('treats two declarations at once as a configuration error, not a choice', () => {
    configure({ NODE_ENV: 'production', DYNASTY_TRUSTED_PROXY_HOPS: '1', DYNASTY_CLIENT_IP_HEADER: 'cf-connecting-ip' });
    expect(clientIdentity(req({ 'cf-connecting-ip': '198.51.100.4' }))).toEqual({ ok: false, reason: 'not_configured' });
    expect(assertProductionConfig().join(' ')).toMatch(/only one of/);
  });

  it.each(['0', '-1', 'abc', '11', '1.5'])('rejects DYNASTY_TRUSTED_PROXY_HOPS=%s', (value) => {
    configure({ NODE_ENV: 'production', DYNASTY_TRUSTED_PROXY_HOPS: value });
    expect(assertProductionConfig().join(' ')).toMatch(/DYNASTY_TRUSTED_PROXY_HOPS must be/);
  });

  it('rejects a header name that is not a plain token', () => {
    configure({ NODE_ENV: 'production', DYNASTY_CLIENT_IP_HEADER: 'x-real-ip; drop' });
    expect(assertProductionConfig().join(' ')).toMatch(/DYNASTY_CLIENT_IP_HEADER must be/);
  });
});

describe('address normalisation', () => {
  it('keys IPv6 by /64, because one subscriber can rotate through a whole /64', () => {
    const a = normaliseIp('2001:db8:abcd:12:1:2:3:4');
    const b = normaliseIp('2001:db8:abcd:12:ffff::9');
    const c = normaliseIp('2001:0db8:abcd:0012::1');
    expect(a).toBe('ip:6:2001:db8:abcd:12::/64');
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('keeps IPv4 exact and rejects anything that is not an address', () => {
    expect(normaliseIp(' 203.0.113.7 ')).toBe('ip:4:203.0.113.7');
    expect(normaliseIp('203.0.113.7.1')).toBeNull();
    expect(normaliseIp('localhost')).toBeNull();
  });
});
