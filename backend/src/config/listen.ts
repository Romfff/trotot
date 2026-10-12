import { isIP } from 'node:net';

export function listenHost(): string {
  const host = process.env.LISTEN_HOST?.trim() || '127.0.0.1';
  if (!isIP(host) && host !== 'localhost') throw new Error('LISTEN_HOST must be an IP address or localhost');
  return host;
}

export function trustedProxyCidrs(): string[] | false {
  const value = process.env.TRUSTED_PROXY_CIDRS?.trim();
  if (!value) return false;
  const cidrs = value.split(',').map(cidr => cidr.trim());
  for (const cidr of cidrs) {
    const parts = cidr.split('/');
    const family = isIP(parts[0]);
    if (parts.length !== 2 || !family || !/^\d+$/.test(parts[1]) || Number(parts[1]) < 1
      || Number(parts[1]) > (family === 4 ? 32 : 128)) {
      throw new Error('TRUSTED_PROXY_CIDRS must contain explicit IP CIDRs with a nonzero prefix');
    }
  }
  return cidrs;
}
