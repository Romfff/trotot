import { NextRequest, NextResponse } from "next/server";
import { publicProxyHeaders } from "@/lib/public-proxy-context";

function json(body: unknown, status: number, retryAfter?: string | null) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...(status === 429 && retryAfter && /^\d{1,6}$/.test(retryAfter) && Number(retryAfter) > 0 ? { "Retry-After": retryAfter } : {}) } });
}

// Allowlisted reads only. Contact reveal alone accepts optional Bearer; never cookies.
export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join("/");
  const validPropertySlug = path.length >= 2 && path[0] === "properties"
    && path[1].length > 0 && path[1].length <= 300
    && path[1] !== "." && path[1] !== ".." && !/[\\/]/.test(path[1]);
  const isDetail = path.length === 2 && validPropertySlug;
  const isEstimate = path.length === 3 && validPropertySlug && path[2] === "cost-estimate";
  const isContact = path.length === 3 && validPropertySlug && path[2] === "contact";
  const isReviews = path.length === 3 && validPropertySlug && path[2] === "reviews";
  const isNearby = path.length === 3 && validPropertySlug && path[2] === "nearby";
  const homestay = path[0] === "homestays" && (
    (path.length === 2 && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,299}$/.test(path[1]) && path[1] !== "units")
    || (path.length === 4 && path[1] === "units" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(path[2]) && path[3] === "calendar"));
  const catalog = path.length === 2 && path[0] === "catalog" && ["provinces", "wards"].includes(path[1]);
  if (route !== "amenities" && route !== "properties/long-term/search" && !isDetail && !isEstimate && !isContact && !isReviews && !isNearby && !homestay && !catalog) {
    return json({ success: false, errorCode: "NOT_FOUND", message: "Không tìm thấy yêu cầu." }, 404);
  }
  try {
    const base = process.env.BACKEND_API_URL;
    const secret = process.env.BFF_PROXY_SECRET;
    const authorization = isContact ? request.headers.get("authorization") : null;
    if (authorization !== null && (authorization.length > 4096 || !/^Bearer [A-Za-z0-9._~-]+$/i.test(authorization))) {
      return json({ success: false, errorCode: "INVALID_ACCESS_TOKEN", message: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." }, 401);
    }
    if ((!base && process.env.NODE_ENV === "production") || !secret || secret.length < 32) throw new Error("API not configured");
    const url = new URL(`${(base || "http://localhost:5000/api/v1").replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}`);
    url.search = request.nextUrl.search;
    const upstream = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        ...publicProxyHeaders(request.headers, url.pathname),
        ...(authorization ? { Authorization: authorization } : {}),
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const envelope = await upstream.json();
    if (!envelope || typeof envelope.success !== "boolean") throw new Error("Invalid upstream envelope");
    return json(envelope, upstream.status, upstream.headers.get("retry-after"));
  } catch {
    return json({ success: false, errorCode: "BACKEND_UNAVAILABLE", message: "Không thể kết nối máy chủ. Vui lòng thử lại sau." }, 503);
  }
}
