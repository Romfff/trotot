import { managementRequest } from "./client";
import { ApiError } from "@/lib/auth-types";
import type { Page } from "./homestays";
export type AdminBankRow = { id: string; hostId: string; bankCode: string; accountNumber: string;
  status: "PENDING" | "VERIFIED" | "REJECTED"; createdAt: string; version: number; isCurrent: boolean };
export type AdminBankDetail = AdminBankRow & { accountName: string; events: {
  id: string; actorId: string; action: "SUBMITTED" | "VERIFIED" | "REJECTED"; reason: string; evidenceNote: string; createdAt: string;
}[] };
export type BankReview = { expectedVersion: number; reason: string; evidenceNote: string };
export type BankReviewResult = { id: string; version: number; status: "VERIFIED" | "REJECTED"; payoutReady: boolean };
const path = "/admin/finance/bank-accounts";
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const version = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 2147483647;
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function invalid(): never { throw new ApiError(502, "INVALID_BANK_RESPONSE", "Dữ liệu ngân hàng chưa hợp lệ. Chưa thể xác nhận kết quả xử lý."); }
function row(v: unknown, masked: boolean): v is AdminBankRow {
  return object(v) && uuid(v.id) && uuid(v.hostId) && typeof v.bankCode === "string" && /^[A-Z0-9_-]{1,20}$/.test(v.bankCode)
    && typeof v.accountNumber === "string" && (masked ? /^\*{4}[A-Za-z0-9]{1,4}$/ : /^[A-Za-z0-9]{1,50}$/).test(v.accountNumber)
    && ["PENDING", "VERIFIED", "REJECTED"].includes(String(v.status)) && date(v.createdAt) && version(v.version) && typeof v.isCurrent === "boolean";
}
function envelope(v: unknown): v is Record<string, unknown> { return object(v) && v.success === true && typeof v.message === "string"; }
export const adminBankApi = {
  async list(page: number, signal?: AbortSignal): Promise<Page<AdminBankRow>> {
    const body = await managementRequest<unknown>(path, { params: { page, limit: 20 }, signal });
    if (!envelope(body) || !Array.isArray(body.data) || !object(body.meta)) return invalid();
    const { meta, data } = body;
    if (meta.page !== page || meta.limit !== 20 || !Number.isSafeInteger(meta.total) || (meta.total as number) < 0
      || meta.totalPages !== Math.ceil((meta.total as number) / 20) || data.length > 20 || data.length > (meta.total as number)
      || !data.every(item => row(item, true) && !("accountName" in item)) || new Set(data.map(item => item.id)).size !== data.length) return invalid();
    return body as Page<AdminBankRow>;
  },
  async detail(id: string, signal?: AbortSignal): Promise<AdminBankDetail> {
    const body = await managementRequest<unknown>(`${path}/${encodeURIComponent(id)}`, { signal });
    if (!envelope(body) || !row(body.data, false)) return invalid();
    const data = body.data as AdminBankDetail;
    if (data.id.toLowerCase() !== id.toLowerCase() || !text(data.accountName, 150) || !Array.isArray(data.events) || data.events.length < 1
      || !data.events.every(event => object(event) && uuid(event.id) && uuid(event.actorId)
        && ["SUBMITTED", "VERIFIED", "REJECTED"].includes(event.action) && text(event.reason, 500) && text(event.evidenceNote, 500) && date(event.createdAt))
      || new Set(data.events.map(event => event.id)).size !== data.events.length) return invalid();
    const sequence = data.events.map(event => event.action).join(",");
    if (sequence !== (data.status === "PENDING" ? "SUBMITTED" : `SUBMITTED,${data.status}`)) return invalid();
    return data;
  },
  async review(id: string, action: "verify" | "reject", input: BankReview, key: string): Promise<BankReviewResult> {
    const body = await managementRequest<unknown>(`${path}/${encodeURIComponent(id)}/${action}`, {
      method: "POST", data: input, headers: { "Idempotency-Key": key },
    });
    if (!envelope(body) || !object(body.data)) return invalid();
    const data = body.data;
    if (data.id !== id || !version(data.version) || data.version !== input.expectedVersion + 1
      || data.status !== (action === "verify" ? "VERIFIED" : "REJECTED") || data.payoutReady !== (action === "verify")) return invalid();
    return data as BankReviewResult;
  },
};
