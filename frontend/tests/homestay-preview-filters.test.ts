import { expect, it } from "vitest";
import { readHomestayPreviewFilters } from "../src/lib/homestay-preview-filters";
const defaults = { checkIn: "2027-11-10", checkOut: "2027-11-12" };
it("reads the shared selection and preserves an explicitly empty destination", () => {
  expect(readHomestayPreviewFilters(new URLSearchParams("dest=&checkIn=2028-02-29&checkOut=2028-03-01&guests=3"), defaults))
    .toEqual({ destination: "", checkIn: "2028-02-29", checkOut: "2028-03-01", adults: "3" });
});
it.each(["2027-02-29", "2027-02-31", "oops", "2027-11-10T00:00:00Z"])("rejects impossible/non-date URL value %s", value => {
  const selection = readHomestayPreviewFilters(new URLSearchParams({checkIn:value,checkOut:value,guests:"NaN"}), defaults);
  expect(selection.checkIn).toBe(defaults.checkIn); expect(selection.checkOut).toBe(defaults.checkOut);
  expect(selection.adults).toBe("2");
});
it.each(["2.5", "Infinity", "NaN"])("avoids an unrepresentable demo select value %s", guests => {
  expect(readHomestayPreviewFilters(new URLSearchParams({guests}), defaults).adults).toBe("2");
});
