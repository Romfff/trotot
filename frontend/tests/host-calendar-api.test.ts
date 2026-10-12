import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostCalendarApi } from "@/lib/api/host-calendar";
import { managementRequest } from "@/lib/api/client";

vi.mock("@/lib/api/client", () => ({ managementRequest: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

const unitId = "11111111-1111-4111-8111-111111111111";
function calendar(month = "2026-10", count = 31) {
  return { unitId, month, timeZone: "Asia/Ho_Chi_Minh", version: 4,
    days: Array.from({ length: count }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, "0")}`, status: "AVAILABLE", price: 350001 })) };
}
const envelope = (data: unknown) => ({ success: true, message: "OK", data });

describe("owner-approved Host calendar client", () => {
  it("uses private list pagination, server envelope and cancellation", async () => {
    const signal = new AbortController().signal;
    const page = { success: true, data: [], meta: { page: 2, limit: 20, total: 0, totalPages: 0 } };
    vi.mocked(managementRequest).mockResolvedValueOnce(page);
    expect(await hostCalendarApi.homestays(2, signal)).toBe(page);
    expect(managementRequest).toHaveBeenCalledWith("/host/homestays", { params: { page: 2, limit: 20 }, signal });
  });
  it.each([
    { data: null }, { data: [{}] }, { data: [{ id: unitId, title: "Room", status: "PUBLISHED", homestayUnits: [{}] }] },
    { meta: { page: 2, limit: 20, total: 0, totalPages: 0 } }, { meta: { page: 1, limit: 20, total: -1, totalPages: 0 } },
  ])("rejects malformed room list %j", async change => {
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 }, ...change });
    await expect(hostCalendarApi.homestays(1)).rejects.toMatchObject({ status: 502 });
  });
  it("preserves month/version/held/blocked values from the server", async () => {
    const signal = new AbortController().signal;
    const data = calendar();
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope(data));
    expect(await hostCalendarApi.read(unitId, "2026-10", signal)).toBe(data);
    expect(managementRequest).toHaveBeenCalledWith(`/host/calendar/${unitId}`, { params: { month: "2026-10" }, signal });
  });
  it.each([0, 350000.5, null])("forwards customPrice=%s without changing price/rounding/version/key", async customPrice => {
    const input = { expectedVersion: 2, dates: ["2026-10-20"], customPrice };
    const data = { version: 3, updatedDates: input.dates };
    vi.mocked(managementRequest).mockResolvedValue(envelope(data));
    expect(await hostCalendarApi.pricing("unit", input, "same-retry-key")).toBe(data);
    await hostCalendarApi.pricing("unit", input, "same-retry-key");
    for (const call of vi.mocked(managementRequest).mock.calls) expect(call).toEqual([
      "/host/calendar/unit/pricing", { method: "PUT", data: input, headers: { "Idempotency-Key": "same-retry-key" } },
    ]);
  });
  it.each([true, false])("sends explicit block target %s, never blind-toggle", async isBlocked => {
    const input = { expectedVersion: 2, dates: ["2026-10-20"], isBlocked };
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope({ version: 3, updatedDates: input.dates }));
    await hostCalendarApi.block("unit", input, "block-retry-key");
    expect(managementRequest).toHaveBeenCalledWith("/host/calendar/unit/toggle-block", { method: "POST", data: input, headers: { "Idempotency-Key": "block-retry-key" } });
  });
  it("propagates cancellation, stale-version and inventory failures without fallback or automatic write retry", async () => {
    for (const error of [new DOMException("Aborted", "AbortError"), { status: 409, errorCode: "STALE_HOMESTAY_VERSION" }, { status: 409, errorCode: "INVENTORY_CONFLICT" }]) {
      vi.mocked(managementRequest).mockRejectedValueOnce(error);
      await expect(hostCalendarApi.block("unit", { expectedVersion: 1, dates: ["2026-10-20"], isBlocked: true }, "key")).rejects.toBe(error);
    }
    expect(managementRequest).toHaveBeenCalledTimes(3);
  });

  it.each([["2028-02", 29], ["2026-02", 28], ["2026-04", 30], ["2026-10", 31]])("accepts complete month %s with %s days and zero price", async (month, count) => {
    const data = calendar(String(month), Number(count));
    data.days[0].price = 0;
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope(data));
    expect(await hostCalendarApi.read(unitId, String(month))).toBe(data);
  });
  it.each([
    { unitId: "22222222-2222-4222-8222-222222222222" }, { month: "2026-11" },
    { timeZone: "UTC" }, { version: 0 }, { version: 1.5 }, { days: [] },
    { days: null }, { days: [null] },
  ])("rejects malformed or mismatched calendar %j", async change => {
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope({ ...calendar(), ...change }));
    await expect(hostCalendarApi.read(unitId, "2026-10")).rejects.toMatchObject({ status: 502, errorCode: "INVALID_HOST_CALENDAR_RESPONSE" });
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it.each(["HELD", "PENDING_HOST_APPROVAL", "BOOKED", "BLOCKED"])("accepts server status %s without guessing availability", async status => {
    const data = calendar();
    const day = { ...data.days[0], status, ...(["HELD", "PENDING_HOST_APPROVAL"].includes(status) ? { bookingId: unitId } : {}) };
    const result = { ...data, days: [day, ...data.days.slice(1)] };
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope(result));
    expect(await hostCalendarApi.read(unitId, "2026-10")).toBe(result);
  });
  it.each([null, { success: false, message: "Error", data: calendar() }, { success: true, data: calendar() }])("rejects an invalid success envelope %j", async response => {
    vi.mocked(managementRequest).mockResolvedValueOnce(response);
    await expect(hostCalendarApi.read(unitId, "2026-10")).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    { date: "2026-10-02" }, { status: "UNKNOWN" }, { price: -1 }, { price: 1.5 },
    { status: "HELD" }, { status: "PENDING_HOST_APPROVAL" },
    { bookingId: "bad-id" }, { bookingId: unitId },
  ])("rejects inconsistent calendar day %j", async change => {
    const data = calendar();
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope({ ...data, days: [{ ...data.days[0], ...change }, ...data.days.slice(1)] }));
    await expect(hostCalendarApi.read(unitId, "2026-10")).rejects.toMatchObject({ errorCode: "INVALID_HOST_CALENDAR_RESPONSE" });
  });
  it.each([
    { version: 2, updatedDates: ["2026-10-20"] },
    { version: 4, updatedDates: ["2026-10-20"] },
    { version: 3, updatedDates: ["2026-10-21"] },
    { version: 3, updatedDates: [] },
    { version: 3, updatedDates: null },
  ])("does not report write success for a wrong version/date result %j", async data => {
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope(data));
    await expect(hostCalendarApi.block(unitId, { expectedVersion: 2, dates: ["2026-10-20"], isBlocked: true }, "key")).rejects.toMatchObject({ status: 502 });
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it.each([["2026-10-21", "2026-10-20"], ["2026-10-20", "2026-10-20"]])("rejects reordered or repeated write dates %j", async updatedDates => {
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope({ version: 3, updatedDates }));
    await expect(hostCalendarApi.pricing(unitId, { expectedVersion: 2, dates: ["2026-10-20", "2026-10-21"], customPrice: null }, "key")).rejects.toMatchObject({ status: 502 });
  });
});
