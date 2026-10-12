import { describe, expect, it, vi } from "vitest";
vi.mock("leaflet/dist/leaflet.css", () => ({}));
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { ListingFeeInput } from "../src/features/host-listings/screens";

describe("explicit mandatory fee declaration", () => {
  it.each(["", "0", "3500.50"])("preserves %j, without silently substituting zero", value => {
    const html = renderToStaticMarkup(<ListingFeeInput name="electricityCost" label="Điện (đ/kWh)" max={9999999999.99} defaultValue={value} />);
    expect(html).toContain(`value="${value}"`);
    expect(html).toContain('required=""');
    expect(html).toContain('type="button"');
    expect(html).toContain("Điện (đ/kWh): Miễn phí / đã gồm trong giá thuê");
  });
  it("attaches field-specific errors without removing the input", () => {
    const html = renderToStaticMarkup(<ListingFeeInput name="garbageCost" label="Rác" max={9999999999.99} defaultValue="" error="Cần kê khai khoản phí này." />);
    expect(html).toContain('name="garbageCost"'); expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="garbageCost-help"'); expect(html).toContain("Cần kê khai khoản phí này.");
  });
});
