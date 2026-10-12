import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { availableAppointmentActions, AppointmentSummary } from "../src/features/appointments/screens";
import type { AppointmentResponseDto } from "../src/lib/api/appointment-types.generated";
const record: AppointmentResponseDto = { id: "fixture", propertyId: "fixture", title: "Fixture room <script>alert(1)</script>", scheduledDate: "2099-10-05", scheduledTime: "15:30:00", status: "PENDING", notes: "<img onerror=alert(1)>", reason: null, cancelledBy: null, createdAt: "2026-10-05T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z" };
const at = Date.parse("2099-10-05T08:30:00Z");
describe("appointment presentation (server is authoritative)", () => {
  it("uses Vietnam appointment strings without UTC conversion and escapes title/notes", () => {
    const html = renderToStaticMarkup(<AppointmentSummary record={record} />);
    expect(html).toContain("05/10/2099"); expect(html).toContain("15:30"); expect(html).toContain("Chờ chủ nhà xác nhận");
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("&lt;img");
    expect(html).not.toContain("Khách:");
  });
  it("shows contact only from the Host response and warns about same-hour appointments", () => {
    const html = renderToStaticMarkup(<AppointmentSummary record={{ ...record, tenantName: "Synthetic guest", tenantPhone: "0990000000", simultaneousAppointments: 2 }} />);
    expect(html).toContain("Synthetic guest"); expect(html).toContain("tel:0990000000"); expect(html).toContain("2 lịch khác cùng giờ");
  });
  it("only offers Tenant cancellation before appointment time", () => {
    for (const status of ["PENDING", "ACCEPTED"] as const) {
      expect(availableAppointmentActions({ ...record, status }, false, at - 1)).toEqual(["cancel"]);
      expect(availableAppointmentActions({ ...record, status }, false, at)).toEqual([]);
    }
  });
  it("does not offer Host acceptance of late pending appointments or early completion", () => {
    expect(availableAppointmentActions(record, true, at - 1)).toEqual(["accept", "reject"]);
    expect(availableAppointmentActions(record, true, at)).toEqual([]);
    expect(availableAppointmentActions({ ...record, status: "ACCEPTED" }, true, at - 1)).toEqual(["cancel"]);
    expect(availableAppointmentActions({ ...record, status: "ACCEPTED" }, true, at)).toEqual(["cancel"]);
    expect(availableAppointmentActions({ ...record, status: "ACCEPTED" }, true, at + 1)).toEqual(["complete", "cancel"]);
  });
  it.each(["CANCELLED", "COMPLETED", "REJECTED"] as const)("terminal %s never offers actions", status => {
    for (const host of [true, false]) expect(availableAppointmentActions({ ...record, status }, host, at - 1)).toEqual([]);
  });
  it("malformed appointment time cannot offer an action", () => {
    expect(availableAppointmentActions({ ...record, scheduledTime: "bad" }, true, at)).toEqual([]);
  });
});
