import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const navigation = vi.hoisted(() => ({ pathname: "/homestay" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
import { PageFrame } from "../src/features/homestays/screens";

describe("homestay navigation presentation", () => {
  it.each([
    ["/homestay", "/homestay"],
    ["/homestay/fixture-room", "/homestay"],
    ["/bookings", "/bookings"],
    ["/host/bookings", "/host/bookings"],
  ])("marks only the existing current section on %s", (pathname, selected) => {
    navigation.pathname = pathname;
    const html = renderToStaticMarkup(<PageFrame title="Kiểm thử"><p>Nội dung giữ nguyên</p></PageFrame>);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const currentLink = html.match(/<a\b[^>]*aria-current="page"[^>]*>/)?.[0];
    expect(currentLink).toContain(`href="${selected}"`);
    for (const href of ["/homestay", "/bookings", "/host/bookings"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain('aria-label="Đặt phòng"');
    expect(html).not.toContain('role="tab"');
    expect(html).toContain("Nội dung giữ nguyên");
  });
  it("does not invent an active section on checkout", () => {
    navigation.pathname = "/checkout";
    expect(renderToStaticMarkup(<PageFrame title="Checkout">Nội dung</PageFrame>)).not.toContain("aria-current");
  });
});
