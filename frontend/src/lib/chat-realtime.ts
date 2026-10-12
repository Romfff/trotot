import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "@/stores/auth-store";

// The chat namespace uses the existing Socket server, never a token in a URL.
export function subscribeChatRealtime(conversationId: string | null, refresh: (conversationId?: string) => void, availability: (connected: boolean) => void) {
  const configured = process.env.NEXT_PUBLIC_PAYMENT_REALTIME_URL;
  let origin: string;
  try {
    const url = new URL(configured || "");
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || !(url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error();
    origin = url.origin;
  } catch { availability(false); return () => {}; }
  const sessionId = useAuthStore.getState().sessionId;
  let stopped = false, socket: Socket | undefined;
  const current = () => {
    const state = useAuthStore.getState();
    return !stopped && !!sessionId && state.sessionId === sessionId && state.status === "authenticated" && state.user?.status === "ACTIVE" && state.user.role !== "ADMIN";
  };
  function connect() {
    socket?.disconnect(); socket = undefined;
    const state = useAuthStore.getState();
    if (!current() || !state.accessToken) { availability(false); return; }
    const active = io(`${origin}/chat`, { path: "/socket.io", transports: ["websocket"], auth: { token: state.accessToken },
      reconnectionAttempts: 5, reconnectionDelay: 1000, reconnectionDelayMax: 10000, timeout: 10000 });
    socket = active;
    const valid = () => current() && socket === active;
    active.on("connect", () => {
      if (!valid()) return;
      refresh(); // Repair missed hints on every reconnect, before joining.
      if (!conversationId) { availability(true); return; }
      active.timeout(5000).emit("joinConversation", { conversationId }, (error: unknown, ack: unknown) => {
        if (!valid()) return;
        const accepted = !error && !!ack && typeof ack === "object" && "ok" in ack && ack.ok === true;
        availability(accepted);
        if (!accepted) active.disconnect();
      });
    });
    active.on("NEW_CHAT_MESSAGE", (body: unknown) => {
      if (valid() && body && typeof body === "object" && !Array.isArray(body)
        && Object.keys(body).length === 2 && "conversationId" in body && typeof body.conversationId === "string"
        && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.conversationId)
        && (!conversationId || body.conversationId === conversationId)
        && "message" in body && typeof body.message === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.message)) refresh(body.conversationId);
    });
    active.on("disconnect", (reason: string) => {
      if (!valid()) return;
      availability(false);
      // A server expiry/ban triggers an authorized HTTP reread, reusing existing Auth refresh.
      if (reason === "io server disconnect") refresh();
    });
    active.on("connect_error", () => { if (valid()) availability(false); });
  }
  const unsubscribe = useAuthStore.subscribe((state, previous) => {
    if (!current()) { socket?.disconnect(); socket = undefined; availability(false); }
    else if (state.accessToken !== previous.accessToken) connect();
  });
  connect();
  return () => { stopped = true; unsubscribe(); socket?.disconnect(); socket = undefined; };
}
