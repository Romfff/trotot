import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { AdminPaymentReviewScreen, PaymentReviewSnapshot } from "@/features/admin-finance/payment-review-screen";
import type { PaymentReview } from "@/lib/api/payment-reviews";

const auth = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/stores/auth-store", () => ({ useAuthStore: () => auth.state }));
const row: PaymentReview = {
  id: "00000000-0000-4000-8000-000000000001", sessionId: "00000000-0000-4000-8000-000000000002",
  bookingId: "00000000-0000-4000-8000-000000000003", bookingCode: "<script>fixture</script>",
  provider: "VNPAY_SANDBOX", transactionNo: "999999999999999", expectedAmount: "9999999999", receivedAmount: "1099",
  reasonCode: "AMOUNT_MISMATCH", sessionBookingVersion: 1, bookingVersion: 2, bookingStatus: "CANCELLED",
  paymentStatus: "PENDING", sessionExpiresAt: "2026-10-06T17:00:00.000Z", payDate: null, receivedAt: "2026-10-06T17:01:00.000Z",
};
const html = (patch: Partial<PaymentReview> = {}) => renderToStaticMarkup(<PaymentReviewSnapshot row={{ ...row, ...patch }} />);
beforeEach(() => { auth.state = { status: "initializing", user: null, sessionId: null }; });
it("shows exact VND, Vietnam midnight/date, nullable payment time, escaped code and all public fields", () => {
  const body = html();
  expect(body).toContain("9.999.999.999đ"); expect(body).toContain("1.099đ");
  expect(body).toContain("07/10/2026"); expect(body).toContain("00:00:00");
  expect(body).toContain("Không có thời điểm hợp lệ trong chứng cứ");
  expect(body).toContain("&lt;script&gt;fixture&lt;/script&gt;"); expect(body).not.toContain("<script>");
  expect((body.match(/<dt/g) || []).length).toBe(16);
  for (const id of [row.id, row.sessionId, row.bookingId]) expect(body).toContain(id);
  expect(body).not.toContain("<button"); expect(body).not.toContain("<form");
  expect(body).toContain("không có nghĩa chứng cứ này đã được đối soát");
});
it.each([
  ["AMOUNT_MISMATCH", "Số tiền không khớp"], ["BOOKING_NOT_PAYABLE", "Đơn không còn đủ điều kiện thanh toán"],
  ["SESSION_CHANGED", "Thông tin đơn hoặc phiên thanh toán đã thay đổi"], ["PAYMENT_TIME_INVALID", "Thời điểm thanh toán chưa hợp lệ"],
  ["SOURCE_EXISTS", "Đơn đã có nguồn thanh toán khác"],
] as const)("renders reason %s without a resolution action", (reasonCode, label) => { expect(html({ reasonCode })).toContain(label); });
it.each([
  ["PENDING_HOST_APPROVAL", "Chờ chủ nhà duyệt"], ["PENDING_PAYMENT", "Chờ thanh toán"], ["CONFIRMED", "Đã xác nhận"],
  ["CHECKED_IN", "Đã nhận phòng"], ["COMPLETED", "Đã hoàn thành"], ["CANCELLED", "Đã hủy"], ["CANCELLED_BY_GUEST", "Khách đã hủy"],
  ["REJECTED_BY_HOST", "Chủ nhà từ chối"], ["CANCELLED_HOST_TIMEOUT", "Hủy do chủ nhà quá hạn phản hồi"],
  ["CANCELLED_TIMEOUT", "Hủy do hết hạn thanh toán"],
])("labels current booking status %s separately from evidence", (bookingStatus, label) => { expect(html({ bookingStatus })).toContain(label); });
it.each([["NOT_CONFIGURED", "Chưa kết nối thanh toán"], ["PENDING", "Chờ thanh toán"], ["PAID", "Đơn đã ghi nhận thanh toán"],
  ["REFUNDED", "Đơn đã ghi nhận hoàn tiền"]])("labels current payment status %s without clearing review", (paymentStatus, label) => {
  const body = html({ paymentStatus }); expect(body).toContain(label); expect(body).toContain("Số tiền không khớp");
});
it("renders provider payment timestamp when present without changing snapshot amounts", () => {
  const body = html({ payDate: row.receivedAt }); expect(body).toContain("00:01:00");
  expect(body).not.toContain("Không có thời điểm hợp lệ trong chứng cứ"); expect(body).toContain("1.099đ");
});
it.each([
  [{ status: "initializing" }, "Đang kiểm tra phiên"], [{ status: "unavailable" }, "Chưa kiểm tra được phiên"],
  [{ status: "anonymous" }, "Đăng nhập"],
  ...["HOST", "TENANT"].map(role => [{ status: "authenticated", sessionId: "fixture", user: { role, status: "ACTIVE" } }, "chỉ dành cho Admin"] as const),
  [{ status: "authenticated", sessionId: "fixture", user: { role: "ADMIN", status: "SUSPENDED" } }, "chỉ dành cho Admin"],
  [{ status: "authenticated", sessionId: null, user: { role: "ADMIN", status: "ACTIVE" } }, "chỉ dành cho Admin"],
] as const)("auth gate does not mount private data queries for %j", (state, message) => {
  auth.state = { ...auth.state, ...state };
  const body = renderToStaticMarkup(<AdminPaymentReviewScreen />);
  expect(body).toContain(message); expect(body).not.toContain("payment-review-list-title");
});
