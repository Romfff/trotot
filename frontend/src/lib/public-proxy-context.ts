import { createHmac } from "node:crypto";
import { isIP } from "node:net";

// Existing public BFF GET protocol. Only trust a header explicitly overwritten by the edge.
export function publicProxyHeaders(headers: Pick<Headers, "get">, pathname: string): Record<string, string> {
  const secret = process.env.BFF_PROXY_SECRET;
  if (!secret || secret.length < 32) throw new Error("Public proxy signing not configured");
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  const clientIp = header ? headers.get(header)?.trim() || "" : "";
  if (header && !isIP(clientIp)) throw new Error("Trusted edge did not provide a single IP");
  const timestamp = String(Date.now());
  return {
    "x-trotot-proxy-timestamp": timestamp, "x-trotot-client-ip": clientIp,
    "x-trotot-proxy-signature": createHmac("sha256", secret).update(`${timestamp}\nGET\n${pathname}\n${clientIp}`).digest("hex"),
  };
}
