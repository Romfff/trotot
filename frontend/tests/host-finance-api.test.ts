import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostFinanceApi } from "@/lib/api/host-finance";
import { managementRequest } from "@/lib/api/client";

const summary = {
  currency: "VND", source: "LEDGER", serverTime: "2026-10-06T00:00:00.000Z", holdHours: 72,
  balances: { waitingCompletion: "0", pendingHold: "550", eligibleBeforeDeductions: "999999999999999999", frozen: "0" },
  payoutOperationsReady: false, bankVerified: false, reviewCount: 3,
};
const journal = {
  id: "00000000-0000-4000-8000-000000000001", bookingId: null, kind: "PAYMENT", createdAt: "2026-10-06T00:00:00.000Z",
  entries: [{ account: "CASH_CLEARING", side: "DEBIT", amount: "999999999999999999" }, { account: "HOST_PAYABLE", side: "CREDIT", amount: "999999999999999999" }],
};
const page = { success: true, message: "Synthetic", data: [journal], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } };

vi.mock("@/lib/api/client", () => ({ managementRequest: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe("Host finance client uses server financial evidence only", () => {
  const revenue = () => ({ year: 2026, timeZone: "Asia/Ho_Chi_Minh", basis: "LEDGER_POSTED", currency: "VND",
    months: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, roomAndCleaning: "0", commission: "0",
      refundRecognized: "0", hostEarned: "0", paidOut: "0", reviewCount: 0, isComplete: true })) });
  it("reads twelve server months and preserves exact signed earnings with abort support", async () => {
    const data = revenue(), signal = new AbortController().signal;
    data.months[1] = { ...data.months[1], roomAndCleaning: "9007199254740993", commission: "-110", hostEarned: "-990", reviewCount: 1, isComplete: false };
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "Synthetic", data });
    expect(await hostFinanceApi.revenue(2026, signal)).toBe(data);
    expect(managementRequest).toHaveBeenCalledWith("/host/finance/revenue", { params: { year: 2026 }, signal });
  });
  it.each(["year", "timeZone", "basis", "currency", "count", "order", "money", "signed", "negativeGross", "review", "complete"])("rejects inconsistent revenue %s without a local fallback", async field => {
    const data = revenue();
    if (field === "year") data.year = 2025;
    if (field === "timeZone") data.timeZone = "UTC";
    if (field === "basis") data.basis = "STAY_DATE";
    if (field === "currency") data.currency = "USD";
    if (field === "count") data.months.pop();
    if (field === "order") data.months.reverse();
    if (field === "money") data.months[0].hostEarned = "1.5";
    if (field === "signed") data.months[0].commission = "-0";
    if (field === "negativeGross") data.months[0].roomAndCleaning = "-1";
    if (field === "review") data.months[0].reviewCount = -1;
    if (field === "complete") data.months[0].isComplete = false;
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "Synthetic", data });
    await expect(hostFinanceApi.revenue(2026)).rejects.toMatchObject({ errorCode: "INVALID_FINANCE_RESPONSE" });
    expect(managementRequest).toHaveBeenCalledOnce();
  });
  it.each([1999, 2101, 2026.5, NaN])("rejects invalid requested revenue year %s before transport", async year => {
    await expect(hostFinanceApi.revenue(year)).rejects.toMatchObject({ errorCode: "INVALID_REVENUE_YEAR" });
    expect(managementRequest).not.toHaveBeenCalled();
  });
  it("does not turn a failed or aborted revenue request into zero earnings", async () => {
    const error = new DOMException("Aborted", "AbortError");vi.mocked(managementRequest).mockRejectedValueOnce(error);
    await expect(hostFinanceApi.revenue(2026)).rejects.toBe(error);
  });
  it("preserves exact VND strings, zero, freeze and non-withdrawable status", async () => {
    const signal = new AbortController().signal;
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "Synthetic", data: summary });
    expect(await hostFinanceApi.summary(signal)).toBe(summary);
    expect(managementRequest).toHaveBeenCalledWith("/host/finance", { signal });
  });
  it("reads nullable bank state without fallback to a cached account", async () => {
    const signal = new AbortController().signal, data = { version: 0, account: null, payoutReady: false };
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, data });
    expect(await hostFinanceApi.bank(signal)).toBe(data);
    expect(managementRequest).toHaveBeenCalledWith("/host/bank-account", { signal });
  });
  it("forwards version zero, unchanged input and the caller's same retry key", async () => {
    const input = { expectedVersion: 0, bankCode: "FIXTURE", accountNumber: "12345678", accountName: "Synthetic fixture" };
    const data = { version: 1, account: { status: "PENDING" }, payoutReady: false };
    vi.mocked(managementRequest).mockResolvedValue({ success: true, data });
    expect(await hostFinanceApi.submitBank(input, "bank-retry")).toBe(data);
    await hostFinanceApi.submitBank(input, "bank-retry");
    for (const call of vi.mocked(managementRequest).mock.calls) expect(call).toEqual([
      "/host/bank-account", { method: "PUT", data: input, headers: { "Idempotency-Key": "bank-retry" } },
    ]);
  });
  it.each(["transactions", "notifications"] as const)("keeps %s pagination meta outside data and supports abort", async name => {
    const signal = new AbortController().signal;
    const envelope = { success: true, message: "Synthetic", data: [], meta: { page: 2, limit: 20, total: 0, totalPages: 0, unreadCount: 0 } };
    vi.mocked(managementRequest).mockResolvedValueOnce(envelope);
    expect(await hostFinanceApi[name](2, signal)).toBe(envelope);
    expect(managementRequest).toHaveBeenCalledWith(name === "transactions" ? "/host/finance/transactions" : "/host/bank-notifications", { params: { page: 2, limit: 20 }, signal });
  });
  it.each([null, {}, { ...summary, currency: "USD" }, { ...summary, source: "CACHE" }, { ...summary, serverTime: "2026-02-30T00:00:00.000Z" },
    { ...summary, holdHours: 48 }, { ...summary, bankVerified: "false" }, { ...summary, payoutOperationsReady: true },
    { ...summary, reviewCount: -1 }, { ...summary, reviewCount: 0.5 }, { ...summary, balances: null },
    ...[999999999999999999, "-1", "1.5", "1e3", "NaN", "", "01", undefined].map(amount => ({ ...summary, balances: { ...summary.balances, pendingHold: amount } })),
  ])("rejects invalid summary instead of coercing financial evidence %j", async data => {
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "Synthetic", data });
    await expect(hostFinanceApi.summary()).rejects.toMatchObject({ status: 502, errorCode: "INVALID_FINANCE_RESPONSE" });
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it("keeps a balanced high-value journal and pagination by reference", async () => {
    vi.mocked(managementRequest).mockResolvedValueOnce(page);
    expect(await hostFinanceApi.transactions(1)).toBe(page);
  });
  it.each([{ requested: 1, total: 21, count: 20 }, { requested: 2, total: 21, count: 1 }, { requested: 3, total: 21, count: 0 }])("accepts complete page $requested of $total journals", async ({ requested, total, count }) => {
    const response = { ...page, data: Array.from({ length: count }, (_, index) => ({ ...journal, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` })),
      meta: { page: requested, limit: 20, total, totalPages: Math.ceil(total / 20) } };
    vi.mocked(managementRequest).mockResolvedValueOnce(response);
    expect(await hostFinanceApi.transactions(requested)).toBe(response);
  });
  it.each([{ requested: 1, total: 1, count: 0 }, { requested: 1, total: 21, count: 1 }, { requested: 2, total: 22, count: 1 },
    { requested: 3, total: 21, count: 1 }, { requested: 0, total: 0, count: 0 }, { requested: 1.5, total: 0, count: 0 }])("rejects missing or surplus journals on page $requested", async ({ requested, total, count }) => {
    vi.mocked(managementRequest).mockResolvedValueOnce({ ...page, data: Array.from({ length: count }, () => journal),
      meta: { page: requested, limit: 20, total, totalPages: Math.ceil(total / 20) } });
    await expect(hostFinanceApi.transactions(requested)).rejects.toMatchObject({ errorCode: "INVALID_FINANCE_RESPONSE" });
  });
  it.each(["PAYMENT", "REFUND", "PAYOUT", "ADJUSTMENT"])("accepts exact multi-line %s evidence, not a computed wallet", async kind => {
    const response = { ...page, data: [{ ...journal, kind, bookingId: "00000000-0000-4000-8000-000000000002", entries: [
      { account: "CASH_CLEARING", side: "DEBIT", amount: "9007199254740993" },
      { account: "HOST_PAYABLE", side: "CREDIT", amount: "9007199254740992" },
      { account: "PLATFORM_COMMISSION", side: "CREDIT", amount: "1" },
    ] }] };
    vi.mocked(managementRequest).mockResolvedValueOnce(response);
    expect(await hostFinanceApi.transactions(1)).toBe(response);
  });
  it.each(["summary", "transactions"] as const)("propagates %s transport/abort errors without a zero-money fallback", async name => {
    for (const failure of [new DOMException("Aborted", "AbortError"), { status: 403, errorCode: "FORBIDDEN" }, { status: 429, errorCode: "RATE_LIMITED" }, { status: 503, errorCode: "UNAVAILABLE" }]) {
      vi.mocked(managementRequest).mockRejectedValueOnce(failure);
      await expect(name === "summary" ? hostFinanceApi.summary() : hostFinanceApi.transactions(1)).rejects.toBe(failure);
    }
    expect(managementRequest).toHaveBeenCalledTimes(4);
  });
  it.each([
    null, { ...page, success: false }, { ...page, message: undefined }, { ...page, data: null }, { ...page, meta: null },
    ...[{ ...page.meta, page: 2 }, { ...page.meta, limit: 10 }, { ...page.meta, total: 1.5 }, { ...page.meta, total: -1 },
      { ...page.meta, total: Number.MAX_SAFE_INTEGER + 1 }, { ...page.meta, totalPages: 0 }].map(meta => ({ ...page, meta })),
    { ...page, data: [journal, journal], meta: { ...page.meta, total: 2 } },
    ...[{ ...journal, id: "wrong-id" }, { ...journal, bookingId: "wrong-id" }, { ...journal, kind: "PAID" },
      { ...journal, createdAt: "not-a-date" }, { ...journal, entries: [] }, { ...journal, entries: journal.entries.slice(0, 1) },
      ...["0", "-1", "0.5", "1e3", "NaN", "01", "1000000000000000000", 999999999999999999].map(amount => ({ ...journal, entries: journal.entries.map(line => ({ ...line, amount })) })),
      { ...journal, entries: [{ ...journal.entries[0], amount: "999999999999999998" }, journal.entries[1]] },
      { ...journal, entries: journal.entries.map(line => ({ ...line, account: "UNRECOGNIZED" })) },
      { ...journal, entries: journal.entries.map(line => ({ ...line, side: "credit" })) },
    ].map(row => ({ ...page, data: [row] })),
  ])("rejects incomplete, unbalanced or inconsistent history %j", async response => {
    vi.mocked(managementRequest).mockResolvedValueOnce(response);
    await expect(hostFinanceApi.transactions(1)).rejects.toMatchObject({ status: 502, errorCode: "INVALID_FINANCE_RESPONSE" });
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
  it("marks a bank event read with an empty body, not a recipient or account payload", async () => {
    const data = { id: "notice", readAt: "2026-10-06T00:00:00Z" };
    vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, data });
    expect(await hostFinanceApi.markRead("notice")).toBe(data);
    expect(managementRequest).toHaveBeenCalledWith("/host/bank-notifications/notice/read", { method: "POST", data: {} });
  });
  it.each([new DOMException("Aborted", "AbortError"), { status: 409, errorCode: "STALE_BANK_VERSION" }, { status: 409, errorCode: "IDEMPOTENCY_CONFLICT" }, { status: 503, errorCode: "BANK_RECORDING_FAILED" }])("does not fabricate success, replace key or automatically retry %j", async error => {
    vi.mocked(managementRequest).mockRejectedValueOnce(error);
    await expect(hostFinanceApi.submitBank({ expectedVersion: 1, bankCode: "FIXTURE", accountNumber: "1234", accountName: "Synthetic" }, "key")).rejects.toBe(error);
    expect(managementRequest).toHaveBeenCalledTimes(1);
  });
});
