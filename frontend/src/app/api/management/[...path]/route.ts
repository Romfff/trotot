import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", Vary: "Origin, Authorization" } });
}
function failure(status: number, errorCode: string, message: string) { return json({ success: false, errorCode, message }, status); }

// Fixed private routes only; current roles and ownership remain enforced by backend.
async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }, method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH") {
  const { path } = await context.params;
  const root = path[0] === "admin" && path[1] === "properties";
  const nearbyRead = root && method === "GET" && path.length === 4 && uuid.test(path[2]) && path[3] === "nearby";
  const nearbyWrite = root && method === "PATCH" && path.length === 6 && uuid.test(path[2]) && path[3] === "nearby" && uuid.test(path[4]) && path[5] === "visibility";
  const bookingPath = path[0] === "bookings" ? path : path[0] === "host" && path[1] === "bookings" ? path.slice(1) : [];
  const bookings = bookingPath[0] === "bookings" && (method === "GET"
    ? bookingPath.length === 1 || (bookingPath.length === 2 && uuid.test(bookingPath[1]))
    : (path[0] === "bookings" && path.length === 2 && path[1] === "hold")
      || (bookingPath.length === 3 && uuid.test(bookingPath[1]) && (path[0] === "host"
        ? ["accept", "reject", "check-in", "complete"].includes(bookingPath[2]) : bookingPath[2] === "cancel")));
  const payment = path.length === 3 && path[0] === "bookings" && uuid.test(path[1])
    && (method === "GET" && ["payment-status", "payment-session"].includes(path[2]) || method === "POST" && path[2] === "payment-session");
  const review = path.length === 3 && path[0] === "bookings" && uuid.test(path[1]) && path[2] === "review" && ["GET", "POST"].includes(method);
  const chatCreate = method === "POST" && path.length === 1 && path[0] === "conversations";
  const chatMessages = path.length === 3 && path[0] === "conversations" && uuid.test(path[1]) && path[2] === "messages" && ["GET", "POST"].includes(method);
  const chatRead = method === "POST" && path.length === 3 && path[0] === "conversations" && uuid.test(path[1]) && path[2] === "read";
  const chat = chatCreate || chatMessages || chatRead || method === "GET" && path[0] === "conversations" && (path.length === 1 || path.length === 2 && path[1] === "unread");
  const userAction = method === "POST" && path.length === 4 && path[0] === "admin" && path[1] === "users" && uuid.test(path[2]) && ["ban", "unban"].includes(path[3]);
  const adminUsers = userAction || method === "GET" && path.length === 2 && path[0] === "admin" && path[1] === "users";
  const dashboard = method === "GET" && path.length === 2 && path[0] === "admin" && path[1] === "dashboard";
  const hostListing = path[0] === "host" && path[1] === "properties";
  const ownDetail = hostListing && path.length === 3 && uuid.test(path[2]);
  const createListing = method === "POST" && path.join("/") === "properties/long-term";
  const listingWrite = createListing || (ownDetail && method === "PUT");
  const listingAction = method === "POST" && hostListing && path.length === 4 && uuid.test(path[2])
    && ["hide", "show", "availability"].includes(path[3]);
  const appointmentPath = path[0] === "appointments" ? path : path[0] === "host" && path[1] === "appointments" ? path.slice(1) : [];
  const createAppointment = method === "POST" && path.length === 1 && path[0] === "appointments";
  const appointmentAction = method === "POST" && appointmentPath.length === 3 && uuid.test(appointmentPath[1])
    && (path[0] === "host" ? ["accept", "reject", "complete", "cancel"].includes(appointmentPath[2]) : appointmentPath[2] === "cancel");
  const appointments = createAppointment || appointmentAction || method === "GET" && appointmentPath[0] === "appointments"
    && (appointmentPath.length === 1 || appointmentPath.length === 2 && uuid.test(appointmentPath[1]));
  const readNotification = method === "POST" && path.length === 3 && path[0] === "notifications" && uuid.test(path[1]) && path[2] === "read";
  const notifications = readNotification || method === "GET" && path.length === 1 && path[0] === "notifications";
  const financeNoticeRead = method === "POST" && path.length === 4 && path[0] === "finance" && path[1] === "notifications" && uuid.test(path[2]) && path[3] === "read";
  const financeNotices = financeNoticeRead || method === "GET" && path.length === 2 && path[0] === "finance" && path[1] === "notifications";
  const homestayRoot = path[1] === "homestays" && ["host", "admin"].includes(path[0]);
  const homestayDetail = homestayRoot && path.length >= 3 && uuid.test(path[2]);
  const homestayUnit = homestayDetail && path[0] === "host" && path[3] === "units";
  const homestayWrite = path[0] === "host" && homestayRoot && (
    method === "POST" && path.length === 2 || method === "PUT" && homestayDetail && path.length === 3
    || homestayUnit && (method === "POST" && path.length === 4 || method === "PUT" && path.length === 5 && uuid.test(path[4])));
  const homestayAction = homestayDetail && (method === "POST" && path.length === 4 && (
    path[0] === "host" ? ["hide", "show"].includes(path[3]) : ["approve", "reject"].includes(path[3]))
    || path[0] === "host" && method === "DELETE" && (path.length === 3 || homestayUnit && path.length === 5 && uuid.test(path[4])));
  const hostHomestays = homestayWrite || homestayAction || method === "GET" && homestayRoot
    && (path.length === 2 || path.length === 3 && homestayDetail);
  const hostCalendar = path[0] === "host" && path[1] === "calendar" && uuid.test(path[2] || "");
  const calendarWrite = hostCalendar && path.length === 4
    && (method === "PUT" && path[3] === "pricing" || method === "POST" && path[3] === "toggle-block");
  const calendarRead = hostCalendar && path.length === 3 && method === "GET";
  const bankPath = path.length === 2 && path[0] === "host" && path[1] === "bank-account";
  const bankWrite = bankPath && method === "PUT";
  const adminBank = path[0] === "admin" && path[1] === "finance" && path[2] === "bank-accounts";
  const bankReview = adminBank && method === "POST" && path.length === 5 && uuid.test(path[3]) && ["verify", "reject"].includes(path[4]);
  const adminBankRead = adminBank && method === "GET" && (path.length === 3 || path.length === 4 && uuid.test(path[3]));
  const bankNoticeRead = method === "POST" && path.length === 4 && path[0] === "host" && path[1] === "bank-notifications" && uuid.test(path[2]) && path[3] === "read";
  const payoutNoticeRead = method === "POST" && path.length === 4 && path[0] === "host" && path[1] === "payout-notifications" && uuid.test(path[2]) && path[3] === "read";
  const hostFinanceRead = method === "GET" && path[0] === "host" && (
    bankPath || path.length === 2 && ["finance", "bank-notifications", "payout-notifications"].includes(path[1])
    || path.length === 3 && path[1] === "finance" && ["transactions", "revenue", "debts", "settlements"].includes(path[2])
  );
  const adminPayout = path[0] === "admin" && path[1] === "finance" && path[2] === "payouts";
  const adminRefund = path[0] === "admin" && path[1] === "finance" && path[2] === "refunds";
  const paymentReviewRead = method === "GET" && path[0] === "admin" && path[1] === "finance" && path[2] === "payment-reviews"
    && (path.length === 3 || path.length === 4 && uuid.test(path[3]));
  const bookingComplaint = path.length === 3 && path[0] === "bookings" && uuid.test(path[1]) && path[2] === "complaints";
  const financeComplaint = ["host", "admin"].includes(path[0]) && path[1] === "finance" && path[2] === "complaints";
  const complaintRead = method === "GET" && (bookingComplaint || financeComplaint && (path.length === 3 || path.length === 4 && uuid.test(path[3])));
  const complaintCreate = method === "POST" && bookingComplaint;
  const complaintAction = method === "POST" && financeComplaint && path.length === 5 && uuid.test(path[3])
    && (path[0] === "host" ? path[4] === "respond" : ["assign", "resolve"].includes(path[4]));
  const lateComplaintCreate = method === "POST" && path.length === 5 && path[0] === "admin" && path[1] === "finance" && path[2] === "bookings" && uuid.test(path[3]) && path[4] === "late-refund-cases";
  const complaintWrite = complaintCreate || complaintAction || lateComplaintCreate;
  const noShowRead = method === "GET" && path[0] === "admin" && path[1] === "finance" && path[2] === "no-show-reports"
    && (path.length === 3 || path.length === 4 && uuid.test(path[3]));
  const noShowReport = method === "POST" && path.length === 4 && path[0] === "host" && path[1] === "bookings" && uuid.test(path[2]) && path[3] === "no-show-report";
  const noShowResolve = method === "POST" && path.length === 5 && path[0] === "admin" && path[1] === "finance" && path[2] === "bookings" && uuid.test(path[3]) && path[4] === "resolve-stay";
  const noShowWrite = noShowReport || noShowResolve;
  const refundRead = adminRefund && method === "GET" && (path.length === 3 || path.length === 4 && uuid.test(path[3]));
  const refundConfirm = adminRefund && method === "POST" && path.length === 5 && uuid.test(path[3]) && path[4] === "confirm-paid";
  const settlementCreate = method === "POST" && path.length === 3 && path[0] === "admin" && path[1] === "finance" && path[2] === "settlements";
  const settlementReverse = method === "POST" && path.length === 5 && path[0] === "admin" && path[1] === "finance" && path[2] === "settlements" && uuid.test(path[3]) && path[4] === "reverse";
  const payoutCreate = (adminPayout && method === "POST" && path.length === 3) || settlementCreate;
  const payoutAction = adminPayout && method === "POST" && path.length === 5 && uuid.test(path[3]) && ["approve", "cancel"].includes(path[4]);
  const payoutConfirm = adminPayout && method === "POST" && path.length === 5 && uuid.test(path[3]) && path[4] === "confirm-paid";
  const payoutWrite = payoutCreate || payoutAction || payoutConfirm || settlementReverse;
  const payoutRead = method === "GET" && (adminPayout && (path.length === 3
    || uuid.test(path[3] || "") && (path.length === 4 || path.length === 5 && path[4] === "export"))
    || path[0] === "host" && path[1] === "payouts" && (path.length === 2 || path.length === 3 && uuid.test(path[2])));
  const allowed = review || noShowRead || noShowWrite || paymentReviewRead || complaintRead || complaintWrite || refundRead || refundConfirm || adminBankRead || bankReview || payoutRead || payoutWrite || financeNotices || payment || hostFinanceRead || bankWrite || bankNoticeRead || payoutNoticeRead || hostHomestays || calendarRead || calendarWrite || appointments || notifications || createListing || listingAction || hostListing && (method === "GET"
    ? path.length === 2 || ownDetail : ownDetail && ["PUT", "DELETE"].includes(method))
    || ["GET", "POST"].includes(method) && (bookings || root && (method === "GET"
    ? (path.length === 2 || (path.length === 3 && uuid.test(path[2])))
    : (path.length === 4 && uuid.test(path[2]) && ["approve", "reject"].includes(path[3]))));
  if (!allowed && !chat && !adminUsers && !dashboard && !nearbyRead && !nearbyWrite) return failure(404, "NOT_FOUND", "Không tìm thấy yêu cầu.");
  const authorization = request.headers.get("authorization");
  if (!/^Bearer\s+\S+$/i.test(authorization || "")) return failure(401, "ACCESS_TOKEN_REQUIRED", "Cần đăng nhập để tiếp tục.");
  let body: Record<string, unknown> | undefined;
  if (method !== "GET") {
    if (request.headers.get("origin") !== (process.env.FRONTEND_ORIGIN || "http://localhost:3000")) {
      return failure(403, "INVALID_ORIGIN", "Nguồn gửi yêu cầu không hợp lệ.");
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return failure(415, "JSON_REQUIRED", "Yêu cầu phải dùng JSON.");
    }
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid body");
      const hold = path.join("/") === "bookings/hold";
      const availability = listingAction && path[3] === "availability";
      if (!nearbyWrite && !homestayWrite && !userAction && !chat && !review && !noShowWrite && !complaintWrite && !refundConfirm && !bankReview && !payoutWrite && !hold && !listingWrite && !appointments && !readNotification && !financeNoticeRead && !calendarWrite && !bankWrite && !bankNoticeRead && !payoutNoticeRead && (Object.keys(parsed).length !== (availability ? 2 : 1)
        || !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion <= 0
        || (availability && (typeof parsed.isAvailable !== "boolean" || Object.keys(parsed).some(field => !["expectedVersion", "isAvailable"].includes(field)))))) throw new Error("Invalid body");
      if (nearbyWrite && (Object.keys(parsed).length !== 3 || Object.keys(parsed).some(field=>!["hidden","reason","expectedVersion"].includes(field))
        || typeof parsed.hidden!=="boolean" || typeof parsed.reason!=="string" || !parsed.reason.trim() || parsed.reason.trim().length>500
        || !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion<0 || parsed.expectedVersion>1000000000)) throw new Error("Invalid nearby body");
      if (review && (Object.keys(parsed).length !== 4 || Object.keys(parsed).some(field => !["cleanliness", "location", "value", "comment"].includes(field))
        || ["cleanliness", "location", "value"].some(field => !Number.isInteger(parsed[field]) || parsed[field] < 1 || parsed[field] > 5)
        || typeof parsed.comment !== "string" || !parsed.comment.trim() || parsed.comment.trim().length > 2000)) throw new Error("Invalid review body");
      if (chatCreate && (Object.keys(parsed).length !== 1 || typeof parsed.propertyId !== "string" || !uuid.test(parsed.propertyId))) throw new Error("Invalid conversation body");
      if (chatRead && (Object.keys(parsed).length !== 1 || typeof parsed.messageId !== "string" || !uuid.test(parsed.messageId))) throw new Error("Invalid read cursor body");
      if (userAction && (Object.keys(parsed).length !== 2 || Object.keys(parsed).some(field => !["expectedStatus", "reason"].includes(field))
        || !["ACTIVE", "BANNED"].includes(parsed.expectedStatus) || typeof parsed.reason !== "string" || !parsed.reason.trim() || parsed.reason.trim().length > 500)) throw new Error("Invalid moderation body");
      if (chatMessages && (Object.keys(parsed).length !== 2 || Object.keys(parsed).some(field => !["clientMessageId", "text"].includes(field))
        || typeof parsed.clientMessageId !== "string" || !uuid.test(parsed.clientMessageId)
        || typeof parsed.text !== "string" || !parsed.text.trim() || parsed.text.trim().length > 3000)) throw new Error("Invalid message body");
      if (listingWrite) {
        const fields = ["title", "propertyType", "description", "videoUrl", "addressDetail", "provinceCode", "districtCode", "wardCode", "latitude", "longitude", "monthlyPrice", "depositAmount", "areaSqm", "electricityCost", "waterCost", "waterUnit", "internetCost", "garbageCost", "parkingFee", "contactPhone", "contactZalo", "allowPets", "amenityIds", "imageUrls", ...(method === "PUT" ? ["expectedVersion"] : [])];
        if (Object.keys(parsed).some(field => !fields.includes(field))) throw new Error("Invalid listing body");
        if (method === "PUT" && (!Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion <= 0)) throw new Error("Invalid version");
      }
      if (homestayWrite) {
        const unitFields = ["unitName", "maxAdults", "maxChildren", "maxGuests", "maxNights", "bedrooms", "bathrooms", "basePricePerNight", "weekendPricePerNight", "cleaningFee", "checkInTime", "checkOutTime", "sameDayBookingCutoff", "cancellationPolicy", "instantBook"];
        const create = !homestayUnit && method === "POST";
        const fields = homestayUnit ? unitFields : ["title", "description", "propertyType", "addressDetail", "provinceCode", "wardCode", "latitude", "longitude", "amenityIds", "imageUrls", "videoUrl", ...(create ? ["units"] : [])];
        if (Object.keys(parsed).some(field => ![...fields, ...(!create ? ["expectedVersion"] : [])].includes(field))) throw new Error("Invalid homestay body");
        if (!create && (!Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion <= 0 || parsed.expectedVersion > 2147483646)) throw new Error("Invalid homestay version");
        if (create && (!Array.isArray(parsed.units) || parsed.units.length < 1 || parsed.units.length > 100
          || parsed.units.some((unit: unknown) => !unit || typeof unit !== "object" || Array.isArray(unit) || Object.keys(unit).some(field => !unitFields.includes(field))))) throw new Error("Invalid homestay units");
      }
      if (createAppointment && Object.keys(parsed).some(field => !["propertyId", "tenantName", "tenantPhone", "scheduledDate", "scheduledTime", "notes"].includes(field))) throw new Error("Invalid appointment body");
      if (appointmentAction && (Object.keys(parsed).some(field => !["expectedStatus", "reason"].includes(field))
        || !["PENDING", "ACCEPTED", "REJECTED", "COMPLETED", "CANCELLED"].includes(parsed.expectedStatus)
        || parsed.reason !== undefined && (typeof parsed.reason !== "string" || parsed.reason.trim().length > 500))) throw new Error("Invalid appointment action");
      if (readNotification && Object.keys(parsed).length !== 0) throw new Error("Invalid notification body");
      if (bankNoticeRead && Object.keys(parsed).length !== 0) throw new Error("Invalid bank notification body");
      if (payoutNoticeRead && Object.keys(parsed).length !== 0) throw new Error("Invalid payout notification body");
      if (financeNoticeRead && Object.keys(parsed).length !== 0) throw new Error("Invalid finance notification body");
      if (noShowWrite) {
        const fields = noShowResolve ? ["expectedVersion", "reason", "decision", "evidenceNote"] : ["expectedVersion", "reason"];
        if (Object.keys(parsed).length !== fields.length || Object.keys(parsed).some(field => !fields.includes(field))
          || !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion < (noShowResolve ? 2 : 1) || parsed.expectedVersion > 2147483646
          || (noShowResolve ? ["reason", "evidenceNote"] : ["reason"]).some(field => typeof parsed[field] !== "string" || !parsed[field].trim() || parsed[field].trim().length > 500)
          || noShowResolve && parsed.decision !== "NO_SHOW") throw new Error("Invalid no-show body");
      }
      if (lateComplaintCreate && (Object.keys(parsed).length !== 3 || Object.keys(parsed).some(field=>!["expectedVersion","reason","evidenceNote"].includes(field))
        || !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion<1 || parsed.expectedVersion>2147483646
        || ["reason","evidenceNote"].some(field=>typeof parsed[field]!=="string" || !parsed[field].trim() || parsed[field].trim().length>500))) throw new Error("Invalid late case body");
      if (complaintWrite && !lateComplaintCreate) {
        const action = complaintCreate ? "create" : path[4];
        const fields = action === "respond" ? ["expectedVersion", "message"]
          : action === "assign" ? ["expectedVersion", "reason", "assigneeId"]
          : action === "resolve" ? ["expectedVersion", "reason", "decision", "evidenceNote"] : ["expectedVersion", "reason"];
        if (Object.keys(parsed).length !== fields.length || Object.keys(parsed).some(field => !fields.includes(field))
          || !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion < 1 || parsed.expectedVersion > 2147483646
          || (action === "respond" ? ["message"] : action === "resolve" ? ["reason", "evidenceNote"] : ["reason"])
            .some(field => typeof parsed[field] !== "string" || !parsed[field].trim() || parsed[field].trim().length > 500)
          || action === "assign" && (typeof parsed.assigneeId !== "string" || !uuid.test(parsed.assigneeId))
          || action === "resolve" && parsed.decision !== "HOST") throw new Error("Invalid complaint body");
      }
      if ((payoutCreate || payoutAction) && (Object.keys(parsed).length !== 2
        || Object.keys(parsed).some(field => ![payoutCreate ? "hostId" : "expectedVersion", "reason"].includes(field))
        || typeof parsed.reason !== "string" || !parsed.reason.trim() || parsed.reason.trim().length > 500
        || (payoutCreate ? typeof parsed.hostId !== "string" || !uuid.test(parsed.hostId)
          : !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion < 1 || parsed.expectedVersion > 2147483646))) throw new Error("Invalid payout body");
      if (settlementReverse && (Object.keys(parsed).length !== 1 || typeof parsed.reason !== "string" || !parsed.reason.trim() || parsed.reason.trim().length > 500)) throw new Error("Invalid settlement reversal");
      if ((payoutConfirm || refundConfirm) && (Object.keys(parsed).length !== 4
        || Object.keys(parsed).some(field => !["expectedVersion", "bankReference", "evidenceNote", "reason"].includes(field))
        || !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion < (refundConfirm ? 1 : 2) || parsed.expectedVersion > 2147483646
        || ["bankReference", "evidenceNote", "reason"].some(field => typeof parsed[field] !== "string"
          || !parsed[field].trim() || parsed[field].trim().length > (field === "bankReference" ? 200 : 500)))) throw new Error("Invalid payout confirmation");
      if (bankWrite && (Object.keys(parsed).length !== 4
        || Object.keys(parsed).some(field => !["expectedVersion", "bankCode", "accountNumber", "accountName"].includes(field))
        || !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion < 0 || parsed.expectedVersion > 2147483646
        || typeof parsed.bankCode !== "string" || !/^[A-Z0-9_-]{1,20}$/i.test(parsed.bankCode.trim())
        || typeof parsed.accountNumber !== "string" || !/^[A-Za-z0-9]{1,50}$/.test(parsed.accountNumber.trim())
        || typeof parsed.accountName !== "string" || !parsed.accountName.trim() || parsed.accountName.trim().length > 150)) {
        throw new Error("Invalid bank body");
      }
      if (bankReview && (Object.keys(parsed).length !== 3
        || Object.keys(parsed).some(field => !["expectedVersion", "reason", "evidenceNote"].includes(field))
        || !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion < 0 || parsed.expectedVersion > 2147483646
        || ["reason", "evidenceNote"].some(field => typeof parsed[field] !== "string" || !parsed[field].trim() || parsed[field].trim().length > 500))) {
        throw new Error("Invalid bank review body");
      }
      if (calendarWrite) {
        const valueField = path[3] === "pricing" ? "customPrice" : "isBlocked";
        if (Object.keys(parsed).some(field => !["expectedVersion", "dates", valueField].includes(field))
          || !Number.isSafeInteger(parsed.expectedVersion) || parsed.expectedVersion < 1 || parsed.expectedVersion > 2147483646
          || !Array.isArray(parsed.dates) || parsed.dates.length < 1 || parsed.dates.length > 366
          || new Set(parsed.dates).size !== parsed.dates.length
          || parsed.dates.some((date: unknown) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
          || (valueField === "isBlocked" ? typeof parsed.isBlocked !== "boolean"
            : parsed.customPrice !== null && (typeof parsed.customPrice !== "number" || !Number.isFinite(parsed.customPrice)))) {
          throw new Error("Invalid calendar body");
        }
      }
      if (path.join("/") === "bookings/hold") {
        const fields = ["unitId","checkInDate","checkOutDate","numAdults","numChildren","guestName","guestPhone","guestEmail","guestNotes","quoteToken"];
        if (Object.keys(parsed).some(field => !fields.includes(field))) throw new Error("Invalid hold body");
      }
      body = parsed;
    } catch { return failure(400, "INVALID_BODY", "Dữ liệu gửi lên không hợp lệ."); }
  }
  try {
    const base = process.env.BACKEND_API_URL;
    const secret = process.env.BFF_PROXY_SECRET;
    if ((!base && process.env.NODE_ENV === "production") || !secret || secret.length < 32) throw new Error("API not configured");
    const url = new URL(`${(base || "http://localhost:5000/api/v1").replace(/\/$/, "")}/${path.join("/")}`);
    if (method === "GET") url.search = request.nextUrl.search;
    const header = process.env.TRUSTED_CLIENT_IP_HEADER;
    const clientIp = header ? request.headers.get(header)?.trim() || "" : "";
    if (header && !isIP(clientIp)) throw new Error("Invalid edge IP");
    const timestamp = String(Date.now());
    const upstream = await fetch(url.toString(), {
      method, headers: {
        Accept: "application/json", Authorization: authorization!,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(((bookings || payment) && method === "POST" || nearbyWrite || noShowWrite || complaintWrite || refundConfirm || payoutWrite || createAppointment || calendarWrite || bankWrite || bankReview) && request.headers.get("idempotency-key") ? { "Idempotency-Key": request.headers.get("idempotency-key")! } : {}),
        "x-trotot-proxy-timestamp": timestamp, "x-trotot-client-ip": clientIp,
        "x-trotot-proxy-signature": createHmac("sha256", secret).update(`${timestamp}\n${method}\n${url.pathname}\n${clientIp}`).digest("hex"),
      }, ...(body ? { body: JSON.stringify(body) } : {}),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const envelope = await upstream.json();
    if (!envelope || typeof envelope.success !== "boolean" || envelope.success !== upstream.ok) throw new Error("Invalid envelope");
    const result = json(envelope, upstream.status);
    const retryAfter = upstream.headers.get("retry-after");
    if (upstream.status === 429 && retryAfter && /^\d{1,6}$/.test(retryAfter)) result.headers.set("Retry-After", retryAfter);
    return result;
  } catch { return failure(503, "BACKEND_UNAVAILABLE", payoutConfirm || refundConfirm
    ? "Chưa có kết quả ghi sổ. Thử lại với cùng Idempotency-Key; không chuyển tiền ngân hàng lần nữa."
    : noShowWrite ? "Chưa có kết quả lưu báo cáo khách không đến. Thử lại với cùng nội dung và Idempotency-Key."
    : complaintWrite ? "Chưa có kết quả lưu khiếu nại. Thử lại với cùng nội dung và Idempotency-Key."
    : "Không thể kết nối máy chủ. Vui lòng thử lại sau."); }
}
export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) { return forward(request, context, "GET"); }
export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) { return forward(request, context, "POST"); }
export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) { return forward(request, context, "PUT"); }
export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) { return forward(request, context, "DELETE"); }
export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) { return forward(request, context, "PATCH"); }
