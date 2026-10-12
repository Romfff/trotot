import { beforeEach, expect, it, vi } from "vitest";
import { managementRequest } from "@/lib/api/client";
import { adminPayoutsApi } from "@/lib/api/payouts";
vi.mock("@/lib/api/client", () => ({ managementRequest: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001", at = "2026-10-06T00:00:00.000Z";
const fixture = () => ({ id, hostId: id, amount: "999999999999999999", status: "APPROVED", version: 2, cutoff: at, createdAt: at,
  bankCode: "FIXTURE", accountNumber: "0012AB", accountName: "Synthetic", bankAccountId: id, bankVersion: 1,
  operations: { canApprove: false, canExport: true, canConfirmPaid: true, canCancel: true, reviewRequired: false },
  items: [{ bookingId: id, amount: "999999999999999999", eligibleAt: at, status: "ACTIVE" }],
  events: ["CREATED", "APPROVED"].map(action => ({ action, createdAt: at, actorId: id, reason: "Fixture" })), confirmation: null });
beforeEach(() => vi.clearAllMocks());
it.each([{ accountName: "" }, { accountNumber: "****1234" }, { bankAccountId: "bad" }, { bankVersion: 0 },
  { operations: {} }, { amount: "1.5" }, { events: [] }, { confirmation: {} }, { items: [] }, { status: "PAID" }, { status: ["APPROVED"] }])("rejects invalid Admin payout snapshot %j", async patch => {
  vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data: { ...fixture(), ...patch } });
  await expect(adminPayoutsApi.detail(id)).rejects.toMatchObject({ errorCode: "INVALID_PAYOUT_RESPONSE" });
});
it("validates manual PAID evidence without altering exact snapshot", async () => {
  const base = fixture(), data = { ...base, status: "PAID", version: 3,
    operations: { canApprove: false, canExport: false, canConfirmPaid: false, canCancel: false, reviewRequired: false },
    events: [...base.events, { action: "PAID", createdAt: at, actorId: id, reason: "Synthetic proof" }],
    confirmation: { confirmedAt: at, actorId: id, bankReference: "FIXTURE", evidenceNote: "Synthetic only", reason: "Fixture" } };
  vi.mocked(managementRequest).mockResolvedValueOnce({ success: true, message: "OK", data });
  expect(await adminPayoutsApi.detail(id)).toBe(data);
});
