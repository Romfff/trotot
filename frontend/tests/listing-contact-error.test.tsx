import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../src/lib/api/client", () => ({ managementRequest: vi.fn() }));
import { listingContactError } from "../src/lib/api/host-listings";
import { Input } from "../src/components/ui/input";

describe("listing contact error presentation only", () => {
  it.each(["contactPhone", "contactZalo"] as const)("localizes technical %s errors without exposing regex", field => {
    const raw = `${field} must match /\\+?[0-9]{9,15}$/ regular expression`;
    const message = listingContactError(field, raw);
    expect(message).toContain("không hợp lệ");
    expect(message).toContain("9–15 chữ số");
    expect(message).not.toContain("regular expression");
    expect(message).not.toContain(field);
    const html = renderToStaticMarkup(<Input name={field} label="Liên hệ" type="tel" required={field === "contactPhone"} maxLength={20} defaultValue="abc" error={message} />);
    expect(html).toContain(`name="${field}"`);
    expect(html).toContain(`aria-describedby="${field}-help"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('value="abc"');
    expect(html.includes('required=""')).toBe(field === "contactPhone");
  });
  it.each([undefined, "", "Vui lòng điền trường này.", "Số liên hệ bị chặn."])("preserves absent and friendly errors: %j", message => {
    expect(listingContactError("contactPhone", message)).toBe(message);
    expect(listingContactError("contactZalo", message)).toBe(message);
  });
  it("uses the correct field label", () => {
    expect(listingContactError("contactPhone", "contactPhone must be a string")).toMatch(/^Số điện thoại liên hệ/);
    expect(listingContactError("contactZalo", "contactZalo must be a string")).toMatch(/^Số Zalo/);
  });
  it("does not mutate the API error or relabel another field", () => {
    const fields = { contactPhone: "contactPhone must match pattern", title: "title must be longer" };
    listingContactError("contactPhone", fields.contactPhone);
    expect(fields.contactPhone).toBe("contactPhone must match pattern");
    expect(listingContactError("contactPhone", fields.title)).toBe(fields.title);
  });
});
