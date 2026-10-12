import type { BankReview } from "@/lib/api/admin-bank";
export function reviewFieldErrors(fields: Pick<BankReview, "reason" | "evidenceNote">) {
  const errors: Partial<Record<"reason" | "evidenceNote", string>> = {};
  for (const name of ["reason", "evidenceNote"] as const) {
    if (!fields[name].trim() || fields[name].trim().length > 500) errors[name] = "Nhập từ 1 đến 500 ký tự.";
  }
  return errors;
}
