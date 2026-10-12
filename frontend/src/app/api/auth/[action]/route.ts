import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const REFRESH_COOKIE = "trotot_refresh";
const allowedActions = new Set([
  "register",
  "login",
  "send-otp",
  "verify-otp",
  "forgot-password",
  "reset-password",
  "refresh",
  "logout",
  "me",
  "become-host",
]);

type Envelope = {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
  errorCode?: string;
  errors?: { field: string; message: string }[];
};

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Origin");
  return response;
}

function clearRefreshCookie(response: NextResponse) {
  response.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 0,
  });
}

function hasTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const expectedOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
  return origin === expectedOrigin;
}

async function backend(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  accessToken?: string | null,
  clientIp = "",
): Promise<{ response: Response; envelope: Envelope }> {
  try {
    const secret = process.env.BFF_PROXY_SECRET;
    if (!secret || secret.length < 32) throw new Error("Missing BFF proxy secret");
    const url = new URL(`${process.env.BACKEND_API_URL || "http://localhost:5000/api/v1"}${path}`);
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}\n${method}\n${url.pathname}\n${clientIp}`).digest("hex");
    const response = await fetch(url.toString(), {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        "x-trotot-proxy-timestamp": timestamp,
        "x-trotot-proxy-signature": signature,
        "x-trotot-client-ip": clientIp,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const envelope = await response.json().catch(() => ({})) as Envelope;
    return { response, envelope };
  } catch {
    return {
      response: new Response(null, { status: 503 }),
      envelope: { success: false, errorCode: "BACKEND_UNAVAILABLE", message: "Máy chủ đang bận. Vui lòng thử lại." },
    };
  }
}

function trustedClientIp(request: NextRequest) {
  // Configure only a header overwritten by your edge proxy; never trust it by default.
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  if (!header) return "";
  const ip = request.headers.get(header)?.trim() || "";
  if (!isIP(ip)) throw new Error("Trusted proxy did not provide a single client IP");
  return ip;
}

function dataBody(envelope: Envelope) {
  return { success: envelope.success, message: envelope.message, data: envelope.data };
}

function errorBody(envelope: Envelope) {
  return {
    success: false,
    errorCode: envelope.errorCode || "REQUEST_FAILED",
    message: envelope.message || "Không thể xử lý yêu cầu.",
    ...(envelope.errors ? { errors: envelope.errors } : {}),
  };
}

function hasSessionUser(user: unknown) {
  if (!user || typeof user !== "object" || Array.isArray(user)) return false;
  const candidate = user as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.phone === "string"
    && typeof candidate.fullName === "string"
    && ["TENANT", "HOST", "ADMIN"].includes(String(candidate.role));
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  if (!allowedActions.has(action) || action === "me") {
    return json({ success: false, errorCode: "NOT_FOUND", message: "Không tìm thấy yêu cầu." }, 404);
  }
  if (!hasTrustedOrigin(request)) {
    return json({ success: false, errorCode: "INVALID_ORIGIN", message: "Nguồn gửi yêu cầu không hợp lệ." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return json({ success: false, errorCode: "JSON_REQUIRED", message: "Yêu cầu phải dùng JSON." }, 415);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ success: false, errorCode: "INVALID_BODY", message: "Dữ liệu gửi lên không hợp lệ." }, 400);
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  let clientIp: string;
  try {
    clientIp = trustedClientIp(request);
  } catch {
    return json({ success: false, errorCode: "INVALID_PROXY_CONTEXT", message: "Không xác định được nguồn gửi yêu cầu." }, 503);
  }
  if (action === "refresh" && !refreshToken) {
    return json({ success: false, errorCode: "REFRESH_TOKEN_REVOKED", message: "Phiên đăng nhập đã hết hạn." }, 401);
  }
  if (action === "logout") {
    if (!refreshToken) {
      const result = json({ success: false, errorCode: "REFRESH_TOKEN_REVOKED", message: "Phiên đăng nhập đã hết hạn." }, 401);
      clearRefreshCookie(result);
      return result;
    }
    const { response: upstream, envelope } = await backend("/auth/logout", "POST", { refreshToken }, null, clientIp);
    const result = json(upstream.ok ? dataBody(envelope) : errorBody(envelope), upstream.status);
    clearRefreshCookie(result);
    return result;
  }

  if (action === "become-host") {
    const accessToken = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
    if (!accessToken) return json({ success: false, errorCode: "ACCESS_TOKEN_REQUIRED", message: "Cần đăng nhập để tiếp tục." }, 401);
    const { response: upstream, envelope } = await backend("/auth/become-host", "POST", body, accessToken, clientIp);
    if (upstream.ok && (!hasSessionUser(envelope.data?.user) || (envelope.data?.user as Record<string,unknown>).role !== "HOST")) {
      return json({ success: false, errorCode: "INVALID_BACKEND_RESPONSE", message: "Máy chủ trả thông tin Host không hợp lệ." }, 502);
    }
    // Only return the user; never expose or rewrite refresh credentials for a role change.
    return json(upstream.ok ? { success: envelope.success, message: envelope.message, data: { user: envelope.data?.user } } : errorBody(envelope), upstream.status);
  }

  const upstreamBody = action === "refresh"
    ? { refreshToken }
    : body;
  const { response: upstream, envelope } = await backend(`/auth/${action === "refresh" ? "refresh-token" : action}`, "POST", upstreamBody, null, clientIp);
  if (upstream.ok && (action === "login" || action === "refresh")) {
    const tokens = envelope.data || {};
    const access = tokens.accessToken;
    const refresh = tokens.refreshToken;
    if (typeof access !== "string" || typeof refresh !== "string" || !hasSessionUser(tokens.user)) {
      return json({ success: false, errorCode: "INVALID_BACKEND_RESPONSE", message: "Máy chủ trả phiên đăng nhập không hợp lệ." }, 502);
    }
    const result = json({ ...dataBody(envelope), data: { accessToken: access, user: tokens.user } }, upstream.status);
    result.cookies.set(REFRESH_COOKIE, refresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 30 * 24 * 60 * 60,
    });
    return result;
  }

  const result = json(upstream.ok ? dataBody(envelope) : errorBody(envelope), upstream.status);
  if (action === "refresh" && upstream.status === 401) clearRefreshCookie(result);
  if (action === "reset-password" && upstream.ok) clearRefreshCookie(result);
  return result;
}

export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (action !== "me") return json({ success: false, errorCode: "NOT_FOUND", message: "Không tìm thấy yêu cầu." }, 404);
  const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!accessToken) return json({ success: false, errorCode: "ACCESS_TOKEN_REQUIRED", message: "Cần đăng nhập để tiếp tục." }, 401);
  const { response: upstream, envelope } = await backend("/auth/me", "GET", undefined, accessToken);
  return json(upstream.ok ? dataBody(envelope) : errorBody(envelope), upstream.status);
}
