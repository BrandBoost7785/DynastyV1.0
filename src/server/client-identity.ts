/**
 * Which address an anonymous request is charged to for rate limiting.
 *
 * Next.js route handlers receive no socket address, so the only source of a client address
 * is a forwarding header. Any header a client can write is worthless as an identity: it is
 * the first thing an attacker changes to get a fresh budget. So a header is believed only
 * when the deployment says, in configuration, which proxy wrote it:
 *
 *  - `DYNASTY_TRUSTED_PROXY_HOPS=N`: N trusted proxies append to `x-forwarded-for`. Each one
 *    appends the address it received the request from, so the entry N from the right is the
 *    client. Entries to its left are client-controlled and are ignored.
 *  - `DYNASTY_CLIENT_IP_HEADER=name`: one header that only the platform sets (for example
 *    `cf-connecting-ip`). It must hold exactly one address.
 *
 * Without either, production has no trustworthy identity and refuses the request
 * (`not_configured`). It does not fall back to a shared bucket. Development and tests with no
 * declaration use one `local` bucket and read no headers at all, so a local request cannot be
 * steered into someone else's budget either.
 */
import { isIP } from 'node:net';
import { getEnv } from '../config/env';

export type ClientIdentity =
  | { ok: true; key: string }
  | { ok: false; reason: 'unidentified' | 'not_configured' };

const LOCAL_KEY = 'local';

/** Normalise an address into a rate-limit key. Returns null when the text is not an address. */
export function normaliseIp(raw: string): string | null {
  const value = raw.trim();
  const family = isIP(value);
  if (family === 4) return `ip:4:${value}`;
  if (family === 6) {
    const prefix = ipv6Prefix64(value);
    return prefix === null ? null : `ip:6:${prefix}`;
  }
  return null;
}

/**
 * One subscriber can rotate through an entire /64, so IPv6 is limited per /64 rather than per
 * address. Returns the canonical `a:b:c:d::/64` text.
 */
function ipv6Prefix64(address: string): string | null {
  let text = address.toLowerCase();
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (embedded) {
    const [a, b, c, d] = embedded[1]!.split('.').map(Number);
    text = `${text.slice(0, -embedded[1]!.length)}${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const hextets = groups.slice(0, 4).map((g) => {
    const n = Number.parseInt(g, 16);
    return Number.isFinite(n) && /^[0-9a-f]{1,4}$/.test(g) ? n.toString(16) : null;
  });
  if (hextets.includes(null)) return null;
  return `${hextets.join(':')}::/64`;
}

/** Which address the request is charged to. Never throws. */
export function clientIdentity(request: Request): ClientIdentity {
  const { clientIp, isProduction } = getEnv();

  if (clientIp.problem === null) {
    if (clientIp.header !== null) {
      const raw = request.headers.get(clientIp.header);
      if (raw === null || raw.includes(',')) return { ok: false, reason: 'unidentified' };
      const key = normaliseIp(raw);
      return key === null ? { ok: false, reason: 'unidentified' } : { ok: true, key };
    }

    if (clientIp.trustedProxyHops !== null) {
      const raw = request.headers.get('x-forwarded-for');
      if (raw === null) return { ok: false, reason: 'unidentified' };
      const entries = raw.split(',').map((entry) => entry.trim());
      const index = entries.length - clientIp.trustedProxyHops;
      if (index < 0) return { ok: false, reason: 'unidentified' };
      const key = normaliseIp(entries[index]!);
      return key === null ? { ok: false, reason: 'unidentified' } : { ok: true, key };
    }
  }

  if (isProduction) return { ok: false, reason: 'not_configured' };
  return { ok: true, key: LOCAL_KEY };
}
