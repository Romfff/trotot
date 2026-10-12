import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/auth-types";
import { bankFieldErrors, bankNeedsReplay } from "@/features/host-finance/bank-form";
describe("Host bank form boundary and ambiguous retry", () => {
  const fields = { bankCode: "FIXTURE", accountNumber: "0012AB", accountName: "Synthetic fixture" };
  it("preserves leading zeros and accepts server-supported alphanumeric accounts", () => {
    expect(bankFieldErrors(fields)).toEqual({}); expect(fields.accountNumber).toBe("0012AB");
    expect(bankFieldErrors({ ...fields, bankCode: " fixture ", accountName: "  Fixture  " })).toEqual({});
  });
  it("reports each empty field without guessing a bank or owner", () => {
    expect(Object.keys(bankFieldErrors({ bankCode: "", accountNumber: "", accountName: " " }))).toEqual(["bankCode", "accountNumber", "accountName"]);
  });
  it("enforces exact server character and length limits", () => {
    expect(Object.keys(bankFieldErrors({ bankCode: "A".repeat(21), accountNumber: "12 34", accountName: "A".repeat(151) }))).toHaveLength(3);
    expect(bankFieldErrors({ bankCode: "A".repeat(20), accountNumber: "0".repeat(50), accountName: "A".repeat(150) })).toEqual({});
  });
  it.each([0, 500, 502, 503, 504])("keeps the attempt after ambiguous status %s", status => expect(bankNeedsReplay(new ApiError(status, "FAILURE", "Fixture"))).toBe(true));
  it.each([400, 401, 403, 404, 409, 429])("does not replay definitive status %s automatically", status => expect(bankNeedsReplay(new ApiError(status, "STALE_BANK_VERSION", "Fixture"))).toBe(false));
});
