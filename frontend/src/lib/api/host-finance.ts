import { managementRequest } from "./client";
import { ApiError, type ApiEnvelope } from "@/lib/auth-types";
import type { Page } from "./homestays";

// Exact server ledger strings: never turn these into JS floats or a client wallet.
export type HostFinanceSummary = {
  currency: "VND"; source: "LEDGER"; serverTime: string; holdHours: 72;
  bankVerified: boolean; payoutOperationsReady: false;
  balances: { waitingCompletion: string; pendingHold: string; eligibleBeforeDeductions: string; frozen: string };
  reviewCount: number;
};
export type HostFinanceJournal = {
  id: string; bookingId: string | null; kind: "PAYMENT" | "REFUND" | "PAYOUT" | "ADJUSTMENT"; createdAt: string;
  entries: { account: string; side: "DEBIT" | "CREDIT"; amount: string }[];
};
export type HostRevenue = {
  year: number; timeZone: "Asia/Ho_Chi_Minh"; basis: "LEDGER_POSTED"; currency: "VND";
  months: { month: string; roomAndCleaning: string; commission: string; refundRecognized: string;
    hostEarned: string; paidOut: string; reviewCount: number; isComplete: boolean }[];
};
export type HostBankState = {
  version: number; payoutReady: boolean;
  account: null | { id: string; hostId: string; bankCode: string; accountNumber: string; accountName: string; status: "PENDING" | "VERIFIED" | "REJECTED"; createdAt: string };
};
export type BankNotification = {
  id: string; accountId: string; type: "SUBMITTED" | "VERIFIED" | "REJECTED";
  message: string; readAt: string | null; createdAt: string;
};
export type SubmitBank = { expectedVersion: number; bankCode: string; accountNumber: string; accountName: string };

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const money = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function invalidFinance(): never {
  throw new ApiError(502, "INVALID_FINANCE_RESPONSE", "Dữ liệu tài chính chưa hợp lệ. Hãy tải lại hoặc liên hệ hỗ trợ; chưa thể xác nhận số tiền.");
}
function summaryData(value: unknown): HostFinanceSummary {
  if (!object(value) || value.currency !== "VND" || value.source !== "LEDGER" || !timestamp(value.serverTime)
    || value.holdHours !== 72 || typeof value.bankVerified !== "boolean" || value.payoutOperationsReady !== false
    || !integer(value.reviewCount) || !object(value.balances)) return invalidFinance();
  const balances = value.balances;
  if (!["waitingCompletion", "pendingHold", "eligibleBeforeDeductions", "frozen"].every(key => money(balances[key]))) return invalidFinance();
  return value as HostFinanceSummary;
}
function revenueData(value: unknown, year: number): HostRevenue {
  const signedMoney = (value: unknown) => typeof value === "string" && /^(0|-?[1-9]\d*)$/.test(value);
  if (!object(value) || value.year !== year || value.timeZone !== "Asia/Ho_Chi_Minh" || value.basis !== "LEDGER_POSTED"
    || value.currency !== "VND" || !Array.isArray(value.months) || value.months.length !== 12
    || !value.months.every((row, index) => object(row) && row.month === `${year}-${String(index + 1).padStart(2, "0")}`
      && ["roomAndCleaning", "refundRecognized", "paidOut"].every(key => money(row[key]))
      && ["commission", "hostEarned"].every(key => signedMoney(row[key]))
      && integer(row.reviewCount) && row.isComplete === (row.reviewCount === 0))) return invalidFinance();
  return value as HostRevenue;
}
function journal(value: unknown): value is HostFinanceJournal {
  if (!object(value) || !uuid(value.id) || !(value.bookingId === null || uuid(value.bookingId)) || !timestamp(value.createdAt)
    || !["PAYMENT", "REFUND", "PAYOUT", "ADJUSTMENT"].includes(String(value.kind))
    || !Array.isArray(value.entries) || value.entries.length < 2 || value.entries.length > 20) return false;
  let debit = BigInt(0), credit = BigInt(0);
  for (const entry of value.entries) {
    if (!object(entry) || typeof entry.account !== "string" || !["CASH_CLEARING", "HOST_PAYABLE", "PLATFORM_COMMISSION", "PLATFORM_SERVICE", "TAX_PAYABLE", "REFUND_PAYABLE", "HOST_DEBT"].includes(entry.account)
      || (entry.side !== "DEBIT" && entry.side !== "CREDIT") || !money(entry.amount) || entry.amount === "0" || entry.amount.length > 18) return false;
    if (entry.side === "DEBIT") debit += BigInt(entry.amount); else credit += BigInt(entry.amount);
  }
  // Integrity check only: this never derives a client wallet or payout entitlement.
  return debit === credit;
}
function transactionsData(value: unknown, page: number): Page<HostFinanceJournal> {
  if (!object(value) || value.success !== true || typeof value.message !== "string" || !Array.isArray(value.data) || !object(value.meta)) return invalidFinance();
  const { meta, data } = value;
  if (!integer(page) || page < 1 || meta.page !== page || meta.limit !== 20 || !integer(meta.total) || !integer(meta.totalPages)
    || meta.totalPages !== Math.ceil(meta.total / 20) || data.length !== Math.min(20, Math.max(0, meta.total - (page - 1) * 20))
    || !data.every(journal) || new Set(data.map(row => row.id)).size !== data.length) return invalidFinance();
  return value as Page<HostFinanceJournal>;
}

export const hostFinanceApi = {
  revenue: async (year: number, signal?: AbortSignal) => {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ApiError(400, "INVALID_REVENUE_YEAR", "Năm phải từ 2000 đến 2100.");
    const body = await managementRequest<ApiEnvelope<unknown>>("/host/finance/revenue", { params: { year }, signal });
    if (!object(body) || body.success !== true || typeof body.message !== "string") return invalidFinance();
    return revenueData(body.data, year);
  },
  summary: async (signal?: AbortSignal) => {
    const body = await managementRequest<ApiEnvelope<unknown>>("/host/finance", { signal });
    if (!object(body) || body.success !== true || typeof body.message !== "string") return invalidFinance();
    return summaryData(body.data);
  },
  transactions: async (page: number, signal?: AbortSignal) => transactionsData(await managementRequest<unknown>(
    "/host/finance/transactions", { params: { page, limit: 20 }, signal },
  ), page),
  bank: async (signal?: AbortSignal) => (
    await managementRequest<ApiEnvelope<HostBankState>>("/host/bank-account", { signal })
  ).data,
  submitBank: async (input: SubmitBank, key: string) => (
    await managementRequest<ApiEnvelope<HostBankState>>("/host/bank-account", {
      method: "PUT", data: input, headers: { "Idempotency-Key": key },
    })
  ).data,
  notifications: (page: number, signal?: AbortSignal) => managementRequest<Page<BankNotification> & { meta: { unreadCount: number } }>(
    "/host/bank-notifications", { params: { page, limit: 20 }, signal },
  ),
  markRead: async (id: string) => (
    await managementRequest<ApiEnvelope<BankNotification>>(`/host/bank-notifications/${encodeURIComponent(id)}/read`, { method: "POST", data: {} })
  ).data,
};
