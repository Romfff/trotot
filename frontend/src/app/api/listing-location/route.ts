import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const buckets = new Map<string, { count: number; until: number }>();
let total = { count: 0, until: 0 };

function json(status: number, errorCode: string, message: string) {
  return NextResponse.json({ success: false, errorCode, message }, { status,
    headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}

export async function POST(request: NextRequest) {
  const origin = process.env.FRONTEND_ORIGIN || (process.env.NODE_ENV !== "production" ? request.nextUrl.origin : "");
  if (!origin || request.headers.get("origin") !== origin) return json(403, "ORIGIN_REJECTED", "Yêu cầu không hợp lệ.");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json(415, "JSON_REQUIRED", "Cần gửi JSON.");
  const now = Date.now();
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  const ip = header ? request.headers.get(header)?.trim() || "" : "local-shared";
  if (header && !isIP(ip)) return json(503, "EDGE_IP_UNAVAILABLE", "Chưa thể tìm địa chỉ lúc này.");
  // ponytail: process-local limits while no provider exists; shared edge/Redis limits required before multi-instance geocoding.
  if (total.until <= now) total = { count: 0, until: now + 60_000 };
  for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
  const bucket = buckets.get(ip) || { count: 0, until: now + 60_000 };
  if (++total.count > 120 || bucket.count >= 20 || (!buckets.has(ip) && buckets.size >= 512)) return json(429, "LOCATION_RATE_LIMITED", "Vui lòng chờ một phút rồi tìm lại.");
  bucket.count++; buckets.set(ip, bucket);
  let body: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json(400, "INVALID_ADDRESS", "Chọn địa chỉ trước khi tìm.");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return json(413, "ADDRESS_TOO_LARGE", "Địa chỉ quá dài."); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error();
  } catch { return json(400, "INVALID_ADDRESS", "Địa chỉ không hợp lệ."); }
  if (Object.keys(body).some(key => !["provinceCode", "wardCode", "provinceName", "wardName", "addressDetail"].includes(key))
    || typeof body.provinceCode !== "string" || !/^\d{2}$/.test(body.provinceCode)
    || typeof body.wardCode !== "string" || (body.wardCode !== "" && !/^\d{5}$/.test(body.wardCode))
    || ["provinceName", "wardName", "addressDetail"].some(key => typeof body[key] !== "string" || (body[key] as string).length > 255)
    || !(body.provinceName as string).trim()
    || (body.wardCode === "" ? body.wardName !== "" || (body.addressDetail as string).trim() !== "" : !(body.wardName as string).trim())) return json(400, "INVALID_ADDRESS", "Chọn tỉnh/thành phố và phường/xã hợp lệ.");
  // BLOCKED: owner has not selected a geocoder. No key, external call, invented ward centroid, or address cache.
  // Provider-specific secrets, VN filtering and bounded result cache must be tested after that choice.
  return json(503, "GEOCODING_NOT_CONFIGURED", "Chưa kết nối dịch vụ tìm địa chỉ.");
}
