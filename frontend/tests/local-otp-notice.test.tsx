import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalOtpNotice } from "../src/features/auth/local-otp-notice";

afterEach(() => vi.unstubAllGlobals());

describe("local OTP notice", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("shows a server dev code only on %s", (hostname) => {
    vi.stubGlobal("window", { location: { hostname } });
    const html = renderToStaticMarkup(<LocalOtpNotice code="012345" />);
    expect(html).toContain("012345");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<input");
  });

  it.each(["trotot.vn", "localhost.example.com", "127.0.0.1.example.com", "192.168.1.2", "preview.localhost"])("hides the code on %s", (hostname) => {
    vi.stubGlobal("window", { location: { hostname } });
    expect(renderToStaticMarkup(<LocalOtpNotice code="012345" />)).toBe("");
  });

  it.each([null, "", "12345", "1234567", "abcdef", "<script>"])("hides absent or malformed code %s", (code) => {
    vi.stubGlobal("window", { location: { hostname: "localhost" } });
    expect(renderToStaticMarkup(<LocalOtpNotice code={code} />)).toBe("");
  });

  it("does not include a code in server-rendered HTML", () => {
    vi.stubGlobal("window", undefined);
    expect(renderToStaticMarkup(<LocalOtpNotice code="012345" />)).toBe("");
  });
});
