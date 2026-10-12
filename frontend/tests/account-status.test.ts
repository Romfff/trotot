import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AccountPage from "../src/app/account/page";
import type { User } from "../src/lib/auth-types";

const state = vi.hoisted(() => ({ user: null as User | null, sessionId: "test-session", status: "unavailable" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../src/stores/auth-store", () => ({ useAuthStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock("../src/lib/api/client", () => ({ authApi: { logout: vi.fn(), becomeHost: vi.fn() } }));

it.each(["unavailable", "anonymous"])("shows an accurate account message for %s", (status) => {
  state.status = status;
  state.user = null;
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(AccountPage)));
  if (status === "unavailable") {
    expect(html).toContain("Chưa thể tải tài khoản");
    expect(html).toContain("Thử lại");
    expect(html).not.toContain("Bạn chưa đăng nhập");
  } else {
    expect(html).toContain("Bạn chưa đăng nhập");
    expect(html).not.toContain("Thử lại");
  }
});

it.each([
  ["TENANT",true,"ACTIVE",true], ["TENANT",false,"ACTIVE",false], ["TENANT",true,"BANNED",false],
  ["HOST",true,"ACTIVE",false], ["ADMIN",true,"ACTIVE",false],
] as const)("offers self-promotion only to eligible %s/%s/%s", (role,verified,status,eligible) => {
  state.user = {id:"fixture-user",phone:"0990000000",email:null,fullName:"Fixture",role,isPhoneVerified:verified,
    status,avatarUrl:null,isIdentityVerified:false,createdAt:null,updatedAt:null}; state.status="authenticated";
  const html = renderToStaticMarkup(createElement(QueryClientProvider,{client:new QueryClient()},createElement(AccountPage)));
  if (role==="TENANT") {
    expect(html).toContain("Chuyển sang Chủ nhà");
    const button=html.match(/<button[^>]*>Chuyển sang Chủ nhà<\/button>/)?.[0];
    expect(Boolean(button?.includes("disabled"))).toBe(!eligible);
  } else {
    expect(html).not.toContain("Chuyển sang Chủ nhà");
    if (role==="HOST") expect(html).toContain("Tài khoản Chủ nhà đã sẵn sàng.");
  }
});
