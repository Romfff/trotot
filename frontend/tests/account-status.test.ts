import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AccountPage from "../src/app/account/page";

const state = vi.hoisted(() => ({ user: null, status: "unavailable" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../src/stores/auth-store", () => ({ useAuthStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock("../src/lib/api/client", () => ({ authApi: { logout: vi.fn() } }));

it.each(["unavailable", "anonymous"])("shows an accurate account message for %s", (status) => {
  state.status = status;
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
