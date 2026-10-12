import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListingTypeNavigation } from "../src/components/listing/listing-type-navigation";

describe("existing listing creation routes", () => {
  it.each(["long-term", "homestay"] as const)("shows both routes and one current type for %s", active => {
    const html = renderToStaticMarkup(<ListingTypeNavigation active={active} />);
    expect(html).toContain('aria-label="Chọn loại tin đăng"');
    expect(html).toContain('href="/host/properties/create"');
    expect(html).toContain('href="/host/homestays/create"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const current = active === "homestay" ? "/host/homestays/create" : "/host/properties/create";
    const currentLink = html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0];
    expect(currentLink).toContain(`href="${current}"`);
    expect(html).not.toContain("<button");
  });
});
