import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenHost, trustedProxyCidrs } from './listen.js';
afterEach(() => vi.unstubAllEnvs());
describe('explicit container network configuration', () => {
  it('retains loopback and no forwarded trust by default', () => {
    vi.stubEnv('LISTEN_HOST', ''); vi.stubEnv('TRUSTED_PROXY_CIDRS', '');
    expect(listenHost()).toBe('127.0.0.1'); expect(trustedProxyCidrs()).toBe(false);
  });
  it('accepts explicit internal IPv4/IPv6 binding and proxy CIDRs', () => {
    vi.stubEnv('LISTEN_HOST', '0.0.0.0'); expect(listenHost()).toBe('0.0.0.0');
    vi.stubEnv('LISTEN_HOST', '::'); expect(listenHost()).toBe('::');
    vi.stubEnv('TRUSTED_PROXY_CIDRS', '172.30.247.10/32, fd00::10/128');
    expect(trustedProxyCidrs()).toEqual(['172.30.247.10/32', 'fd00::10/128']);
  });
  it('rejects broad wildcard, hop counts, names and malformed trust configuration', () => {
    for (const value of ['true', '1', 'loopback', '0.0.0.0/0', '::/0', '127.0.0.1', '1.2.3.4/33', '::1/129', '::1/1/2', '1.2.3.4/32,']) {
      vi.stubEnv('TRUSTED_PROXY_CIDRS', value); expect(() => trustedProxyCidrs()).toThrow('TRUSTED_PROXY_CIDRS');
    }
    vi.stubEnv('LISTEN_HOST', 'https://example.test'); expect(() => listenHost()).toThrow('LISTEN_HOST');
  });
});
