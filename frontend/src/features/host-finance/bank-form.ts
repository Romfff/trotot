import { ApiError } from "@/lib/auth-types";
import type { SubmitBank } from "@/lib/api/host-finance";

export type BankFields = Pick<SubmitBank, "bankCode" | "accountNumber" | "accountName">;
export function bankFieldErrors(input: BankFields): Partial<Record<keyof BankFields, string>> {
  const errors: Partial<Record<keyof BankFields, string>> = {};
  if (!/^[A-Z0-9_-]{1,20}$/i.test(input.bankCode.trim())) errors.bankCode = "Mã ngân hàng gồm 1–20 chữ cái, số, dấu gạch ngang hoặc gạch dưới.";
  if (!/^[A-Za-z0-9]{1,50}$/.test(input.accountNumber.trim())) errors.accountNumber = "Số tài khoản gồm 1–50 chữ cái hoặc số, không có khoảng trắng.";
  if (!input.accountName.trim() || input.accountName.trim().length > 150) errors.accountName = "Tên chủ tài khoản cần có từ 1 đến 150 ký tự.";
  return errors;
}

// A failed transport/5xx does not prove that the write rolled back. Keep the
// original body and key while a concurrent idempotency request is serialized.
export function bankNeedsReplay(error: ApiError) {
  return error.status === 0 || error.status >= 500;
}
