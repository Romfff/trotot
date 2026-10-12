import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { filterAddressOptions, normalizeAddressName } from "../src/lib/address-search";
import { AddressCombobox } from "../src/features/host-listings/address-combobox";

const items = [
  { code: "79", name: "Thành phố Hồ Chí Minh" },
  { code: "01", name: "Thành phố Hà Nội" },
  { code: "48", name: "Thành phố Đà Nẵng" },
  { code: "68", name: "Tỉnh Lâm Đồng" },
];
describe("address catalog matching", () => {
  it.each([["ho chi minh", "79"], ["HCM", "79"], ["ha noi", "01"], ["da nang", "48"], ["ĐÀ NẴNG", "48"], ["Thành phố Hà Nội", "01"], ["ho ch", "79"], ["chi mi", "79"], ["nang", "48"], ["lam dong", "68"]])("matches %s", (query, code) => {
    expect(filterAddressOptions(items, query)[0]?.code).toBe(code);
  });
  it.each(["Phường Mũi Né", "Xã Mũi Né", "Tỉnh Mũi Né", "Thành phố Mũi Né"])("strips prefix in %s", name => expect(normalizeAddressName(name)).toBe("mui ne"));
  it("keeps the full current catalog and all matching wards available", () => {
    const catalog = Array.from({ length: 15 }, (_, i) => ({ code: String(i), name: `Phường Bình ${i}` }));
    expect(filterAddressOptions(catalog, "binh")).toHaveLength(15);
    expect(filterAddressOptions(catalog, "")).toEqual(catalog);
    expect(filterAddressOptions(catalog, "14")).toEqual([catalog[14]]);
    expect(catalog).toHaveLength(15);
    expect(filterAddressOptions(items, "xyznotfound")).toEqual([]);
  });
  it("keeps catalog code in a hidden field and disables the ward trigger", () => {
    const html = renderToStaticMarkup(<AddressCombobox name="wardCode" label="Phường/xã" items={[]} value="" onChange={() => {}} disabled hint="Chọn tỉnh/thành phố trước." />);
    expect(html).toContain('type="hidden" name="wardCode" value=""');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("<select");
  });
  it("shows the selected catalog name without changing its code", () => {
    const html = renderToStaticMarkup(<AddressCombobox name="provinceCode" label="Tỉnh/thành phố" items={items} value="79" onChange={() => {}} />);
    expect(html).toContain('name="provinceCode" value="79"');
    expect(html).toContain("Thành phố Hồ Chí Minh");
  });
});
