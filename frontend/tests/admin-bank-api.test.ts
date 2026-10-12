import { beforeEach, describe, expect, it, vi } from "vitest";
import { managementRequest } from "@/lib/api/client";
import { adminBankApi } from "@/lib/api/admin-bank";
import { reviewFieldErrors } from "@/features/admin-finance/bank-review";
vi.mock("@/lib/api/client", () => ({ managementRequest: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000002", hostId = "00000000-0000-4000-8000-000000000001", at = "2026-10-06T00:00:00.000Z";
const row = { id, hostId, bankCode: "FIXTURE", accountNumber: "****0123", status: "PENDING", createdAt: at, version: 1, isCurrent: true };
const detail = () => ({ ...row, accountNumber: "000123", accountName: "Synthetic Host", events: [{ id, actorId: hostId, action: "SUBMITTED", reason: "Fixture", evidenceNote: "Synthetic evidence", createdAt: at }] });
beforeEach(() => vi.clearAllMocks());
describe("Admin bank client", () => {
  it("preserves list mask, envelope and AbortSignal", async () => {
    const signal = new AbortController().signal, body = { success: true, message: "OK", data: [row], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } };
    vi.mocked(managementRequest).mockResolvedValueOnce(body);
    expect(await adminBankApi.list(1, signal)).toBe(body);
    expect(managementRequest).toHaveBeenCalledWith("/admin/finance/bank-accounts", { params: { page: 1, limit: 20 }, signal });
  });
  it.each([{ accountNumber: "000123" }, { accountName: "Private" }, { version: NaN }, { status: "UNKNOWN" }])("rejects malformed/private list %j", async patch => {
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data: [{ ...row, ...patch }], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } });
    await expect(adminBankApi.list(1)).rejects.toMatchObject({ errorCode: "INVALID_BANK_RESPONSE" });
  });
  it.each(["PENDING", "VERIFIED", "REJECTED"])("reads current or historical %s detail", async status => {
    const data = detail(); data.status = status; data.isCurrent = false;
    if (status !== "PENDING") data.events.push({ ...data.events[0], id: hostId, action: status });
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data });
    expect(await adminBankApi.detail(id)).toBe(data);
    expect(data.accountNumber).toBe("000123");
  });
  it.each([{ id: hostId }, { accountNumber: "****0123" }, { accountName: "" }, { version: 0 }, { events: [] }, { isCurrent: "true" }])("rejects invalid detail %j", async patch => {
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data: { ...detail(), ...patch } });
    await expect(adminBankApi.detail(id)).rejects.toMatchObject({ errorCode: "INVALID_BANK_RESPONSE" });
  });
  it.each(["verify", "reject"] as const)("forwards %s exact payload and caller replay key", async action => {
    const input = { expectedVersion: 1, reason: " Fixture ", evidenceNote: " Synthetic evidence " };
    const data = { id, version: 2, status: action === "verify" ? "VERIFIED" : "REJECTED", payoutReady: action === "verify" };
    vi.mocked(managementRequest).mockResolvedValue({ success: true, message: "OK", data });
    expect(await adminBankApi.review(id, action, input, "same-key")).toBe(data);
    await adminBankApi.review(id, action, input, "same-key");
    for (const call of vi.mocked(managementRequest).mock.calls) expect(call).toEqual([`/admin/finance/bank-accounts/${id}/${action}`, {
      method: "POST", data: input, headers: { "Idempotency-Key": "same-key" },
    }]);
  });
  it.each([{ version: 3 }, { id: hostId }, { status: "PENDING" }, { payoutReady: false }])("does not accept uncertain verification %j", async patch => {
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data: { id, version: 2, status: "VERIFIED", payoutReady: true, ...patch } });
    await expect(adminBankApi.review(id, "verify", { expectedVersion: 1, reason: "Fixture", evidenceNote: "Fixture" }, "key")).rejects.toMatchObject({ status: 502 });
  });
  it.each([{ status: 409, errorCode: "STALE_BANK_VERSION" }, { status: 503, errorCode: "BANK_RECORDING_FAILED" }, new DOMException("Aborted", "AbortError")])("preserves error without automatic retry %j", async error => {
    vi.mocked(managementRequest).mockRejectedValueOnce(error);
    await expect(adminBankApi.review(id, "reject", { expectedVersion: 1, reason: "Fixture", evidenceNote: "Fixture" }, "key")).rejects.toBe(error);
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it("validates both review fields, including trim and 500-character boundary", () => {
    expect(reviewFieldErrors({ reason: " ", evidenceNote: "" })).toEqual({ reason: "Nhập từ 1 đến 500 ký tự.", evidenceNote: "Nhập từ 1 đến 500 ký tự." });
    expect(reviewFieldErrors({ reason: "x".repeat(500), evidenceNote: " y " })).toEqual({});
    expect(reviewFieldErrors({ reason: "x".repeat(501), evidenceNote: "y" })).toHaveProperty("reason");
  });
});
