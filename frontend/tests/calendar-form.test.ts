import { describe, expect, it } from "vitest";
import { calendarCells, calendarPriceError, calendarRange, shiftCalendarMonth } from "@/features/host-finance/calendar-form";
import type { HostCalendar } from "@/lib/api/host-calendar";
const days: HostCalendar["days"] = Array.from({ length: 31 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, status: "AVAILABLE", price: 350000 }));
describe("Host calendar presentation helpers", () => {
  it("keeps six rows and Monday first", () => {
    const cells = calendarCells("2026-10", days);
    expect(cells).toHaveLength(42); expect(cells.slice(0, 3)).toEqual([null, null, null]); expect(cells[3]).toBe(days[0]); expect(cells[33]).toBe(days[30]);
  });
  it("selects ranges in either direction without selecting other months", () => {
    expect(calendarRange(days, "2026-10-03", "2026-10-01")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(calendarRange(days, "2026-09-30", "2026-10-01")).toEqual(["2026-10-01"]);
  });
  it.each(["0", "1", "350000.5", "9999999999999.99"])("forwards valid price %s for server minimum checks", value => expect(calendarPriceError(value)).toBe(""));
  it.each(["", "-1", "NaN", "Infinity", "1e3", "1.123", "10000000000000"])("rejects invalid price %s", value => expect(calendarPriceError(value)).not.toBe(""));
  it("navigates year boundaries without local timezone", () => {
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01"); expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
  });
});
