import { beforeEach, expect, it, vi } from "vitest";
import { managementRequest } from "@/lib/api/client";
import { payoutNotificationsApi } from "@/lib/api/payout-notifications";

vi.mock("@/lib/api/client", () => ({ managementRequest: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const id = "00000000-0000-4000-8000-000000000001";
const row = { id, batchId: "00000000-0000-4000-8000-000000000002", type: "APPROVED", message: "Đã duyệt, chưa chuyển tiền.", readAt: null, createdAt: "2026-10-06T00:00:00.000Z" };
const envelope = { success: true, message: "Fixture", data: [row], meta: { page: 1, limit: 20, total: 1, totalPages: 1, unreadCount: 1 } };
it.each([0, -1, 1.5, NaN, Infinity, 1000001, Number.MAX_SAFE_INTEGER, "1", null, undefined])("rejects invalid page before transport %j", async page => {
  await expect(payoutNotificationsApi.list(page as number)).rejects.toMatchObject({ errorCode: "INVALID_PAYOUT_NOTIFICATION_RESPONSE" });
  expect(managementRequest).not.toHaveBeenCalled();
});
it("accepts the maximum contract page without treating an empty last page as an error", async () => {
  const value = { ...envelope, data: [], meta: { page: 1000000, limit: 20, total: 1, totalPages: 1, unreadCount: 1 } };
  vi.mocked(managementRequest).mockResolvedValueOnce(value);
  expect(await payoutNotificationsApi.list(1000000)).toBe(value);
});
it("retains server wording and passes abort without polling", async () => {
  const signal = new AbortController().signal;
  vi.mocked(managementRequest).mockResolvedValueOnce(envelope);
  expect(await payoutNotificationsApi.list(1, signal)).toBe(envelope);
  expect(managementRequest).toHaveBeenCalledWith("/host/payout-notifications", { params: { page: 1, limit: 20 }, signal });
});
it.each([null, { ...envelope, success: false }, { ...envelope, data: [] },
  { ...envelope, meta: { ...envelope.meta, unreadCount: 2 } },
  { ...envelope, meta: { ...envelope.meta, unreadCount: 0 } },
  { ...envelope, data: [{ ...row, readAt: row.createdAt }] },
  { ...envelope, data: [{ ...row, type: ["APPROVED"] }] },
  ...[{ ...row, type: "TRANSFERRED" }, { ...row, createdAt: "2026-02-30T00:00:00.000Z" }, { ...row, accountNumber: "private" },
    { ...row, message: "" }, { ...row, readAt: "bad" }].map(value => ({ ...envelope, data: [value] })),
])("rejects malformed/private notification response %j", async value => {
  vi.mocked(managementRequest).mockResolvedValueOnce(value);
  await expect(payoutNotificationsApi.list(1)).rejects.toMatchObject({ errorCode: "INVALID_PAYOUT_NOTIFICATION_RESPONSE" });
});
it("marks read using only empty body and validates matching receipt", async () => {
  const data = { ...row, readAt: "2026-10-06T01:00:00.000Z" };
  vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "Fixture", data });
  expect(await payoutNotificationsApi.markRead(id)).toBe(data);
  expect(managementRequest).toHaveBeenCalledWith(`/host/payout-notifications/${id}/read`, { method: "POST", data: {} });
});
it.each([row, { ...row, id: row.batchId, readAt: row.createdAt }])("rejects unread or mismatched receipt", async data => {
  vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "Fixture", data });
  await expect(payoutNotificationsApi.markRead(id)).rejects.toMatchObject({ status: 502 });
});
it.each([403, 429, 503])("preserves transport error %i without fabricating read receipt", async status => {
  const failure = { status };
  vi.mocked(managementRequest).mockRejectedValueOnce(failure);
  await expect(payoutNotificationsApi.markRead(id)).rejects.toBe(failure);
});
