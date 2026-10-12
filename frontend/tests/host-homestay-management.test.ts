import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PUT, DELETE } from "../src/app/api/management/[...path]/route";
import { homestayContent, homestayUnitInput, homestayFormContent, unitTime } from "../src/lib/api/host-homestays";
import type { OwnHomestay } from "../src/lib/api/host-homestays";
vi.mock("../src/lib/api/client", () => ({ managementRequest: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001", unit = "00000000-0000-4000-8000-000000000002";
const origin = "http://localhost:3000";
const unitBody = { unitName: "Phòng A", maxAdults: 2, maxChildren: 0, maxGuests: null, maxNights: 90, bedrooms: 1, bathrooms: 1,
  basePricePerNight: 500000, weekendPricePerNight: null, cleaningFee: 0, checkInTime: "14:00:00", checkOutTime: "12:00:00", sameDayBookingCutoff: "18:00:00", cancellationPolicy: "FLEXIBLE", instantBook: false };
const body = { title: "Homestay", description: "Mô tả", propertyType: "HOMESTAY" as const, addressDetail: "24 Đường A", provinceCode: "79", wardCode: "26740",
  latitude: 10.7725, longitude: 106.6578, videoUrl: null, imageUrls: [], amenityIds: [] };
function form(input: Record<string, unknown>) { const result = new FormData(); for (const [key, value] of Object.entries(input)) {
  if (value == null || value === false) continue;
  if (Array.isArray(value)) for (const item of value) result.append(key, String(item)); else result.append(key, value === true ? "on" : String(value));
} return result; }
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("approved Host homestay form mapping", () => {
  it("sends catalog codes, rounded coordinates and no district, contact, fees, role or status", () => {
    const result = homestayContent(form({ ...body, latitude: 10.772512345, title: " Homestay ", amenityIds: ["wifi"], districtCode: "fake", role: "ADMIN" }), []);
    expect(result).toEqual({ ...body, latitude: 10.772512, amenityIds: ["wifi"] });
  });
  it.each(["", "NaN", "Infinity", "-1", "300"])('rejects invalid latitude %s', latitude => {
    expect(() => homestayContent(form({ ...body, latitude }), [])).toThrow();
  });
  it("preserves zero vs blank, optional null, seconds and checkboxes", () => {
    expect(homestayUnitInput(form({ ...unitBody, checkInTime: "14:00", instantBook: true }))).toEqual({ ...unitBody, instantBook: true });
    expect(() => homestayUnitInput(form({ ...unitBody, cleaningFee: "" }))).toThrow();
    expect(homestayUnitInput(form({ ...unitBody, weekendPricePerNight: 0 }))).toMatchObject({ weekendPricePerNight: 0, instantBook: false });
    expect(unitTime("1970-01-01T14:30:15.000Z")).toBe("14:30:15"); expect(unitTime("18:00:00")).toBe("18:00:00");
  });
  it("edits from existing pending/rejected revision and retains existing media order", () => {
    const record = { ...body, amenities: [{ amenityId: "wifi" }], images: [{ url: "second", position: 2 }, { url: "first", position: 1 }], revision: null } as unknown as OwnHomestay;
    expect(homestayFormContent(record)).toMatchObject({ amenityIds: ["wifi"], imageUrls: ["first", "second"] });
    expect(homestayFormContent({ ...record, revision: { status: "PENDING_REVIEW", content: { ...body, title: "Pending" } } }).title).toBe("Pending");
  });
});
describe("approved homestay management BFF, server retains ownership/RBAC", () => {
  function setup() {
    vi.stubEnv("FRONTEND_ORIGIN", origin); vi.stubEnv("BACKEND_API_URL", "http://backend.test/api/v1"); vi.stubEnv("BFF_PROXY_SECRET", "homestay-bff-test-0123456789abcdef"); vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
    const upstream = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { id } }))); vi.stubGlobal("fetch", upstream); return upstream;
  }
  const request = (method: string, input?: unknown, headers: Record<string, string> = {}) => new NextRequest(origin, { method, headers: { authorization: "Bearer fixture", origin, "content-type": "application/json", ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
  it.each([
    ["POST", ["host", "homestays"], { ...body, units: [unitBody] }],
    ["PUT", ["host", "homestays", id], { ...body, expectedVersion: 2 }],
    ["POST", ["host", "homestays", id, "units"], { ...unitBody, expectedVersion: 3 }],
    ["PUT", ["host", "homestays", id, "units", unit], { ...unitBody, expectedVersion: 4 }],
    ["DELETE", ["host", "homestays", id, "units", unit], { expectedVersion: 4 }],
    ["DELETE", ["host", "homestays", id], { expectedVersion: 2 }],
    ["POST", ["host", "homestays", id, "hide"], { expectedVersion: 2 }],
    ["POST", ["host", "homestays", id, "show"], { expectedVersion: 2 }],
    ["POST", ["admin", "homestays", id, "approve"], { expectedVersion: 2 }],
    ["POST", ["admin", "homestays", id, "reject"], { expectedVersion: 2 }],
  ])("forwards only approved %s %j", async (method, path, input) => {
    const upstream = setup(); const handler = method === "POST" ? POST : method === "PUT" ? PUT : DELETE;
    const result = await handler(request(method as string, input, { cookie: "never-forward" }), context(path as string[])); expect(result.status).toBe(200);
    const [url, options] = upstream.mock.calls[0]; expect(url).toBe(`http://backend.test/api/v1/${(path as string[]).join("/")}`);
    expect(JSON.parse(options.body)).toEqual(input); expect(new Headers(options.headers).get("authorization")).toBe("Bearer fixture");
    expect(new Headers(options.headers).get("cookie")).toBeNull(); expect(result.headers.get("cache-control")).toBe("no-store");
  });
  it("supports Admin queue/detail without public or arbitrary mutation paths", async () => {
    const upstream = setup();
    for (const path of [["admin", "homestays"], ["admin", "homestays", id], ["host", "homestays"], ["host", "homestays", id]]) expect((await GET(request("GET"), context(path))).status).toBe(200);
    upstream.mockClear();
    for (const path of [["admin", "homestays", id, "hide"], ["host", "homestays", id, "approve"], ["host", "homestays", id, "units", "../bad"], ["admin", "homestays", "units", unit, "fees"]]) expect((await POST(request("POST", { expectedVersion: 2 }), context(path))).status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("rejects escalation, fee tampering, bad version and cross-origin before upstream", async () => {
    const upstream = setup(); const create = ["host", "homestays"], update = ["host", "homestays", id];
    for (const extra of [{ status: "PUBLISHED" }, { hostId: id }, { role: "ADMIN" }, { districtCode: "fake" }, { expectedVersion: 1 }]) expect((await POST(request("POST", { ...body, units: [unitBody], ...extra }), context(create))).status).toBe(400);
    for (const units of [[], null, [{ ...unitBody, commissionRate: 8 }], [{ ...unitBody, status: "PUBLISHED" }]]) expect((await POST(request("POST", { ...body, units }), context(create))).status).toBe(400);
    for (const expectedVersion of [0, "2", 2147483647]) expect((await PUT(request("PUT", { ...body, expectedVersion }), context(update))).status).toBe(400);
    expect((await POST(request("POST", { ...body, units: [unitBody] }, { origin: "https://evil.test" }), context(create))).status).toBe(403);
    expect((await GET(request("GET", undefined, { authorization: "" }), context(create))).status).toBe(401); expect(upstream).not.toHaveBeenCalled();
  });
  it.each([403, 404, 409, 429, 503])("preserves backend %s without auto-retrying", async status => {
    const upstream = setup(); upstream.mockResolvedValue(new Response(JSON.stringify({ success: false, errorCode: "TEST_ERROR", message: "Test" }), { status, headers: { "retry-after": "20" } }));
    const result = await POST(request("POST", { expectedVersion: 2 }), context(["admin", "homestays", id, "approve"]));
    expect(result.status).toBe(status); expect(upstream).toHaveBeenCalledTimes(1); expect(result.headers.get("retry-after")).toBe(status === 429 ? "20" : null);
  });
});
