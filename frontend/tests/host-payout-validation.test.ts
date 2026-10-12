import { beforeEach, describe, expect, it, vi } from "vitest";
import { managementRequest } from "@/lib/api/client";
import { hostPayoutsApi } from "@/lib/api/payouts";
vi.mock("@/lib/api/client", () => ({ managementRequest: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111", hostId = "22222222-2222-4222-8222-222222222222";
const at = "2026-10-06T00:00:00.000Z";
const fixture = () => ({ id, hostId, amount: "999999999999999999", status: "APPROVED", version: 2,
  cutoff: at, createdAt: at, bankCode: "VCB", accountNumber: "****0123",
  items: [{ bookingId: "33333333-3333-4333-8333-333333333333", amount: "999999999999999999", eligibleAt: at, status: "ACTIVE" }],
  events: [{ action: "CREATED", createdAt: at }, { action: "APPROVED", createdAt: at }], confirmation: null as null | { confirmedAt: string } });
beforeEach(() => vi.clearAllMocks());
describe("Host payout response boundary", () => {
  it.each(["DRAFT", "APPROVED", "CANCELLED", "PAID"])("reads exact %s snapshot without a wallet calculation", async status => {
    const data = fixture(); data.status = status;
    data.events = (status === "DRAFT" ? ["CREATED"] : status === "APPROVED" ? ["CREATED", "APPROVED"]
      : status === "CANCELLED" ? ["CREATED", "CANCELLED"] : ["CREATED", "APPROVED", "PAID"]).map(action => ({ action, createdAt: at }));
    if (status === "CANCELLED") data.items[0].status = "RELEASED";
    if (status === "PAID") data.confirmation = { confirmedAt: at };
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data });
    const signal = new AbortController().signal;
    expect(await hostPayoutsApi.detail(id, signal, hostId)).toBe(data);
    expect(managementRequest).toHaveBeenCalledWith(`/host/payouts/${id}`, { signal });
  });
  it.each([
    { amount: "1.5" }, { amount: 100 }, { amount: "1000000000000000000" }, { status: "UNKNOWN" }, { status: ["APPROVED"] },
    { accountNumber: "00123456789" }, { accountName: "Private" }, { bankAccountId: id }, { operations: {} },
    { hostId: id }, { id: hostId }, { cutoff: "invalid" }, { confirmation: { confirmedAt: at } },
    { items: [] }, { items: [{ ...fixture().items[0], amount: "1" }] },
    { events: [{ action: "CREATED", createdAt: at }] },
    { events: [{ action: "CREATED", createdAt: at, actorId: id }, ...fixture().events.slice(1)] },
  ])("fails closed for invalid/private detail %j", async patch => {
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data: { ...fixture(), ...patch } });
    await expect(hostPayoutsApi.detail(id, undefined, hostId)).rejects.toMatchObject({ errorCode: "INVALID_PAYOUT_RESPONSE" });
  });
  it("rejects PAID without confirmation", async () => {
    const data = fixture(); data.status = "PAID"; data.events.push({ action: "PAID", createdAt: at });
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data });
    await expect(hostPayoutsApi.detail(id)).rejects.toMatchObject({ errorCode: "INVALID_PAYOUT_RESPONSE" });
  });
  it.each([{ totalPages: 2 }, { limit: 21 }, { page: 2 }, { total: -1 }])("rejects inconsistent list metadata %j", async patch => {
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0, ...patch } });
    await expect(hostPayoutsApi.list(1)).rejects.toMatchObject({ errorCode: "INVALID_PAYOUT_RESPONSE" });
  });
  it("propagates transport cancellation without retry", async () => {
    const error = new DOMException("Aborted", "AbortError");
    vi.mocked(managementRequest).mockRejectedValueOnce(error);
    await expect(hostPayoutsApi.list(1)).rejects.toBe(error);
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it.each([{ page: 1, total: 21, count: 20 }, { page: 2, total: 21, count: 1 }, { page: 3, total: 21, count: 0 }])("accepts complete payout page $page", async ({ page, total, count }) => {
    const row = fixture();
    const response = { success: true, message: "OK", data: Array.from({ length: count }, (_, index) => ({ ...row, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` })),
      meta: { page, limit: 20, total, totalPages: Math.ceil(total / 20) } };
    vi.mocked(managementRequest).mockResolvedValueOnce(response);
    expect(await hostPayoutsApi.list(page, undefined, hostId)).toBe(response);
  });
  it.each([{ page: 1, total: 1, count: 0 }, { page: 1, total: 21, count: 1 }, { page: 2, total: 22, count: 1 },
    { page: 3, total: 21, count: 1 }, { page: 0, total: 0, count: 0 }, { page: 1.5, total: 0, count: 0 }])("rejects false empty or incomplete payout page $page", async ({ page, total, count }) => {
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data: Array.from({ length: count }, () => fixture()),
      meta: { page, limit: 20, total, totalPages: Math.ceil(total / 20) } });
    await expect(hostPayoutsApi.list(page)).rejects.toMatchObject({ errorCode: "INVALID_PAYOUT_RESPONSE" });
  });
});
