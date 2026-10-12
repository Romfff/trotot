import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { BookingReview, PropertyReviews, ReviewContent, reviewErrors } from "@/features/reviews/reviews";
import { useAuthStore } from "@/stores/auth-store";
import type { User } from "@/lib/auth-types";
import type { Review } from "@/lib/api/reviews";

// Zustand's SSR hook reads getInitialState; these tests explicitly simulate a
// hydrated browser snapshot. Real hydration/actions are covered in Playwright.
vi.mock("@/stores/auth-store", async importOriginal => {
  const actual = await importOriginal<typeof import("@/stores/auth-store")>();
  return { useAuthStore: Object.assign(() => actual.useAuthStore.getState(), actual.useAuthStore) };
});

const review: Review = { id: "fixture-review", cleanliness: 1, location: 3, value: 5,
  comment: "<script>fixture only</script>\n" + "long".repeat(50), authorName: "<img src=x onerror=alert(1)>", createdAt: "2026-10-07T17:30:00Z" };
const input = { cleanliness: 1, location: 3, value: 5, comment: " Nhận xét " };
const user = { id: "fixture-guest", status: "ACTIVE", role: "TENANT" } as User;
function render(element: React.ReactNode, client = new QueryClient()) {
  return renderToStaticMarkup(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
afterEach(() => useAuthStore.getState().clearSession());
it("renders all three scores, Vietnam date, escaped name/comment and long-text wrapping without invented average", () => {
  const body = renderToStaticMarkup(<ReviewContent review={review} />);
  for (const text of ["Sạch sẽ", "Vị trí", "Đáng tiền", "1/5", "3/5", "5/5", "8 thg 10, 2026"]) expect(body).toContain(text);
  expect(body).toContain("&lt;script&gt;"); expect(body).toContain("&lt;img"); expect(body).not.toContain("<script>");
  expect(body).not.toContain("<img"); expect(body).toContain("overflow-wrap:anywhere");
  expect(body).not.toContain("aggregateRating"); expect(body).not.toContain("<form");
});
it("accepts integer boundaries and trimmed comment length", () => {
  expect(reviewErrors(input)).toEqual({});
  expect(reviewErrors({ ...input, comment: " " + "x".repeat(2000) + " " })).toEqual({});
});
it.each([0, 6, 1.5, NaN, Infinity])("rejects invalid rating %s", score => {
  expect(reviewErrors({ ...input, cleanliness: score })).toHaveProperty("cleanliness");
});
it.each(["", "  \n ", "x".repeat(2001)])("rejects missing/overlong comment", comment => {
  expect(reviewErrors({ ...input, comment })).toHaveProperty("comment");
});
it("asks for all three ratings instead of preselecting a score", () => {
  expect(Object.keys(reviewErrors({ cleanliness: 0, location: 0, value: 0, comment: "" }))).toEqual(["cleanliness", "location", "value", "comment"]);
});
it.each(["TENANT", "HOST"] as const)("mounts the own-review entry only for active %s in the current session", role => {
  useAuthStore.getState().setSession("synthetic-not-token", { ...user, role }, "fixture-session");
  const body = render(<BookingReview bookingId="fixture-booking" sessionId="fixture-session" />);
  expect(body).toContain("Xem / viết đánh giá"); expect(body).toContain('aria-expanded="false"');
  expect(body).not.toContain("<form");
});
it.each([
  ["authenticated", "ADMIN", "ACTIVE", "fixture-session"], ["authenticated", "TENANT", "BANNED", "fixture-session"],
  ["anonymous", "TENANT", "ACTIVE", "fixture-session"], ["initializing", "TENANT", "ACTIVE", "fixture-session"],
  ["authenticated", "TENANT", "ACTIVE", "other-session"],
] as const)("does not show private review for %s/%s/%s/%s", (status, role, accountStatus, sessionId) => {
  useAuthStore.setState({ status, user: { ...user, role, status: accountStatus }, sessionId });
  expect(render(<BookingReview bookingId="fixture-booking" sessionId="fixture-session" />)).toBe("");
});
it("renders an announced loading state rather than an empty list before public data arrives", () => {
  const body = render(<PropertyReviews slug="fixture-property" />);
  expect(body).toContain("Đang tải đánh giá"); expect(body).toContain('aria-busy="true"');
  expect(body).not.toContain("Chưa có đánh giá");
});
it("renders real empty result without fake scores or dead pagination", () => {
  const client = new QueryClient(); client.setQueryData(["property-reviews", "fixture-property", 1], { data: [], meta: { page: 1, total: 0, totalPages: 0 } });
  const body = render(<PropertyReviews slug="fixture-property" />, client);
  expect(body).toContain("Chưa có đánh giá cho chỗ ở này."); expect(body).not.toContain("Phân trang"); expect(body).not.toContain("/5");
});
it.each([1, 3])("renders public scores with pagination only for %s pages", totalPages => {
  const client = new QueryClient(); client.setQueryData(["property-reviews", "fixture-property", 1], { data: [review], meta: { page: 1, total: 11, totalPages } });
  const body = render(<PropertyReviews slug="fixture-property" />, client);
  expect(body).toContain("11 đánh giá"); expect(body.includes("Phân trang đánh giá")).toBe(totalPages > 1);
  expect(body).not.toContain("bookingId"); expect(body).not.toContain("Gửi đánh giá");
});
