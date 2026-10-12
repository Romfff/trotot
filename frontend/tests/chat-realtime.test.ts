import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { io } from "socket.io-client";
import { subscribeChatRealtime } from "@/lib/chat-realtime";
import { useAuthStore } from "@/stores/auth-store";
import type { User } from "@/lib/auth-types";
vi.mock("socket.io-client", () => ({ io: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001", user = { id, role: "TENANT", status: "ACTIVE" } as User;
function socketFixture() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = { on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); return socket; }), timeout: vi.fn(), emit: vi.fn(), disconnect: vi.fn() };
  socket.timeout.mockReturnValue(socket); vi.mocked(io).mockReturnValue(socket as unknown as ReturnType<typeof io>);
  return { socket, fire: (name: string, ...args: unknown[]) => handlers.get(name)?.(...args) };
}
let cleanup = () => {};
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_PAYMENT_REALTIME_URL", "http://localhost:5000"); useAuthStore.getState().setSession("memory-only-fixture", user, "session-a"); });
afterEach(() => { cleanup(); cleanup = () => {}; useAuthStore.getState().clearSession(); vi.unstubAllEnvs(); });
it("mock transport: sends token only in handshake, joins selected conversation and refreshes after reconnect", () => {
  const f = socketFixture(), refresh = vi.fn(), available = vi.fn(); cleanup = subscribeChatRealtime(id, refresh, available);
  expect(io).toHaveBeenCalledWith("http://localhost:5000/chat", expect.objectContaining({ auth: { token: "memory-only-fixture" } }));
  f.fire("connect"); expect(f.socket.emit.mock.calls[0].slice(0, 2)).toEqual(["joinConversation", { conversationId: id }]);
  f.socket.emit.mock.calls[0][2](null, { ok: true }); expect(available).toHaveBeenLastCalledWith(true);
  f.fire("connect"); expect(refresh).toHaveBeenCalledTimes(2);
});
it("ignores cross-conversation and private/malformed hints; authoritative data is reread, not accepted from Socket", () => {
  const f = socketFixture(), refresh = vi.fn(); cleanup = subscribeChatRealtime(id, refresh, vi.fn());
  for (const hint of [null, [], { conversationId: "other", message: id }, { conversationId: id, message: id, text: "private" }, { conversationId: id, message: "bad" }]) f.fire("NEW_CHAT_MESSAGE", hint);
  expect(refresh).not.toHaveBeenCalled(); f.fire("NEW_CHAT_MESSAGE", { conversationId: id, message: id }); expect(refresh).toHaveBeenCalledOnce();
});
it("drops late hints/acks after logout and another login of the same account", () => {
  const f = socketFixture(), refresh = vi.fn(), available = vi.fn(); cleanup = subscribeChatRealtime(id, refresh, available); f.fire("connect"); refresh.mockClear();
  useAuthStore.getState().clearSession(); useAuthStore.getState().setSession("new", user, "session-b");
  f.fire("NEW_CHAT_MESSAGE", { conversationId: id, message: id }); f.socket.emit.mock.calls[0][2](null, { ok: true });
  expect(refresh).not.toHaveBeenCalled(); expect(available).not.toHaveBeenCalledWith(true); expect(f.socket.disconnect).toHaveBeenCalled();
});
it("reconnects on token rotation and ignores the old socket", () => {
  const a = socketFixture(), refresh = vi.fn(); cleanup = subscribeChatRealtime(id, refresh, vi.fn()); const b = socketFixture();
  useAuthStore.getState().setAccessToken("rotated-memory"); a.fire("NEW_CHAT_MESSAGE", { conversationId: id, message: id }); expect(refresh).not.toHaveBeenCalled();
  b.fire("connect"); expect(refresh).toHaveBeenCalledOnce(); expect(io).toHaveBeenLastCalledWith("http://localhost:5000/chat", expect.objectContaining({ auth: { token: "rotated-memory" } }));
});
it("disconnects denied membership without altering Auth", () => {
  const f = socketFixture(), available = vi.fn(); cleanup = subscribeChatRealtime(id, vi.fn(), available); f.fire("connect");
  f.socket.emit.mock.calls[0][2](null, { ok: false }); expect(f.socket.disconnect).toHaveBeenCalledOnce(); expect(available).toHaveBeenLastCalledWith(false); expect(useAuthStore.getState().status).toBe("authenticated");
});
it("unmount stops all late callbacks", () => {
  const f = socketFixture(), refresh = vi.fn(); cleanup = subscribeChatRealtime(id, refresh, vi.fn()); cleanup(); f.fire("connect"); f.fire("NEW_CHAT_MESSAGE", { conversationId: id, message: id }); expect(refresh).not.toHaveBeenCalled();
});
it("subscribes to the session inbox without joining a panel and refetches on hints/reconnect", () => {
  const f = socketFixture(), refresh = vi.fn(), available = vi.fn();
  cleanup = subscribeChatRealtime(null, refresh, available);
  f.fire("connect"); expect(f.socket.emit).not.toHaveBeenCalled(); expect(available).toHaveBeenLastCalledWith(true);
  f.fire("NEW_CHAT_MESSAGE", {conversationId: id, message: id}); expect(refresh).toHaveBeenLastCalledWith(id);
  f.fire("NEW_CHAT_MESSAGE", {conversationId: "invalid", message: id}); expect(refresh).toHaveBeenCalledTimes(2);
  useAuthStore.getState().clearSession(); f.fire("NEW_CHAT_MESSAGE", {conversationId: id, message: id}); expect(refresh).toHaveBeenCalledTimes(2);
});
it("repairs server disconnect via API reread but ignores late disconnects after logout", () => {
  const f = socketFixture(), refresh = vi.fn();cleanup = subscribeChatRealtime(null, refresh, vi.fn());
  f.fire('disconnect','io server disconnect');expect(refresh).toHaveBeenCalledOnce();
  f.fire('disconnect','transport close');expect(refresh).toHaveBeenCalledOnce();
  useAuthStore.getState().clearSession();f.fire('disconnect','io server disconnect');expect(refresh).toHaveBeenCalledOnce();
});
it.each(["", "http://remote.test", "https://remote.test/?token=x", "https://user:pass@remote.test/", "https://remote.test/chat"])("does not connect with unsafe configuration %s", url => {
  vi.stubEnv("NEXT_PUBLIC_PAYMENT_REALTIME_URL", url); cleanup = subscribeChatRealtime(id, vi.fn(), vi.fn()); expect(io).not.toHaveBeenCalled();
});
it.each([{ ...user, role: "ADMIN" }, { ...user, status: "BANNED" }])("never connects an unauthorized account %j", account => {
  useAuthStore.getState().setSession("fixture", account as User, "session-a"); cleanup = subscribeChatRealtime(id, vi.fn(), vi.fn()); expect(io).not.toHaveBeenCalled();
});
