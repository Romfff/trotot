import { headers } from "next/headers";
import { publicProxyHeaders } from "@/lib/public-proxy-context";
import { ListingApiError } from "@/lib/api/listings";

export async function publicReadHeaders(path: string): Promise<Record<string, string>> {
  // Local without an edge deliberately keeps the existing shared transport bucket.
  if (!process.env.TRUSTED_CLIENT_IP_HEADER) return {};
  try {
    const base = process.env.BACKEND_API_URL;
    if (!base && process.env.NODE_ENV === "production") throw new Error("API not configured");
    const url = new URL(`${(base || "http://localhost:5000/api/v1").replace(/\/$/, "")}/${path}`);
    return publicProxyHeaders(await headers(), url.pathname);
  } catch {
    // Never fall back to an unsigned request if trusted edge configuration is broken.
    throw new ListingApiError(503, "PUBLIC_PROXY_UNAVAILABLE", "Chưa thể kết nối máy chủ.");
  }
}
