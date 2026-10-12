import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostCalendarApi } from "@/lib/api/host-calendar";
import { managementRequest } from "@/lib/api/client";

vi.mock("@/lib/api/client", () => ({ managementRequest: vi.fn() }));
const unitId = "11111111-1111-4111-8111-111111111111";
const bookingId = "22222222-2222-4222-8222-222222222222";
const data = { unitId, bookingId, bookingCode: "TEST-BOOKING", checkInDate: "2026-10-10", checkOutDate: "2026-10-12",
  guestName: "Khách kiểm thử", guestPhone: "0990000001", bookingStatus: "CONFIRMED", paymentStatus: "PAID" };
beforeEach(() => vi.clearAllMocks());
describe("private calendar booking detail", () => {
  it("reads the existing Host endpoint with signal and retains only displayed fields", async () => {
    const signal = new AbortController().signal;
    vi.mocked(managementRequest).mockResolvedValue({ success: true, message: "OK", data: { ...data, guestEmail: "fixture@example.test", policy: {} } });
    expect(await hostCalendarApi.booking(unitId, bookingId, "2026-10-10", signal)).toEqual(data);
    expect(managementRequest).toHaveBeenCalledWith(`/host/bookings/${bookingId}`, { signal });
  });
  it.each([
    { bookingId: unitId }, { unitId: bookingId }, { guestName: null }, { guestPhone: null }, { guestPhone: "" },
    { guestName: " " }, { bookingCode: 123 }, { bookingStatus: null }, { paymentStatus: null },
    { checkInDate: "2026-10-11" }, { checkOutDate: "2026-10-10" }, { checkInDate: "2026-02-30" },
    { checkInDate: "0000-01-01" }, { checkOutDate: "invalid" },
  ])("rejects malformed/mismatched contact response %j", async change => {
    vi.mocked(managementRequest).mockResolvedValue({ success: true, message: "OK", data: { ...data, ...change } });
    await expect(hostCalendarApi.booking(unitId, bookingId, "2026-10-10")).rejects.toMatchObject({ status: 502 });
  });
  it.each([null, {}, { success: false, data }, { success: true, data }, { success: true, message: "OK", data: null }])("rejects invalid envelope %j", async response => {
    vi.mocked(managementRequest).mockResolvedValue(response);
    await expect(hostCalendarApi.booking(unitId, bookingId, "2026-10-10")).rejects.toMatchObject({ status: 502 });
  });
  it.each(["2026-10-09", "2026-10-12", "2026-10-99"])('rejects dates outside booking %s', async date => {
    vi.mocked(managementRequest).mockResolvedValue({ success: true, message: "OK", data });
    await expect(hostCalendarApi.booking(unitId, bookingId, date)).rejects.toMatchObject({ status: 502 });
  });
  it.each([403, 404, 503])("does not fabricate contacts or retry after %i", async status => {
    const failure = { status };
    vi.mocked(managementRequest).mockRejectedValue(failure);
    await expect(hostCalendarApi.booking(unitId, bookingId, "2026-10-10")).rejects.toBe(failure);
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
});
