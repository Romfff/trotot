import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationBadge, NotificationBell } from "../src/components/layout/notification-bell";
import type { User } from "../src/lib/auth-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/components/layout/notification-bell.module.css", () => ({ default: { dot: "dot", badge: "badge", trigger: "trigger" } }));
const auth = vi.hoisted(() => ({ state: {} as { user?: User; status?: string; sessionId?: string } }));
vi.mock("../src/stores/auth-store", () => ({ useAuthStore: Object.assign(() => auth.state, { getState: () => auth.state }) }));
const user = { id: "fixture-user", fullName: "Fixture", role: "TENANT", status: "ACTIVE" } as User;
afterEach(() => { auth.state = {}; });

describe("appointment notification bell", () => {
  it.each([undefined, 0])("no fabricated badge for count %s", (count) => {
    expect(renderToStaticMarkup(<NotificationBadge count={count} />)).toBe("");
  });
  it("one unread notice is a dot, not the numeral 1", () => {
    const html = renderToStaticMarkup(<NotificationBadge count={1} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/><\/span>$/);
  });
  it.each([2, 9, 10, 1284500])("badge caps visual count %s at 9+", (count) => {
    expect(renderToStaticMarkup(<NotificationBadge count={count} />)).toContain(`>${count > 9 ? "9+" : count}</span>`);
  });
  it.each(["initializing", "anonymous", "unavailable"] as const)("hidden during %s", (status) => {
    auth.state = { status, user, sessionId: "fixture-session" };
    expect(renderToStaticMarkup(<NotificationBell />)).toBe("");
  });
  it.each([{ role: "ADMIN", status: "ACTIVE" }, { role: "TENANT", status: "BANNED" }])("does not request an unauthorized user's notices: %s", (fields) => {
    auth.state = { status: "authenticated", user: { ...user, ...fields } as User, sessionId: "fixture-session" };
    expect(renderToStaticMarkup(<NotificationBell />)).toBe("");
  });
  it.each(["TENANT", "HOST"] as const)("uses server count with full accessible number for %s", (role) => {
    auth.state = { status: "authenticated", user: { ...user, role }, sessionId: "fixture-session" };
    const client = new QueryClient();
    client.setQueryData(["appointment-notifications", "fixture-session", 1], { success: true, data: [], meta: { unreadCount: 23 } });
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><NotificationBell /></QueryClientProvider>);
    expect(html).toContain('aria-label="Thông báo, 23 chưa đọc"');
    expect(html).toContain('>9+</span>');
    client.clear();
  });
});
