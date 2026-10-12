import type { User } from "@/lib/auth-types";
import { useAuthStore } from "@/stores/auth-store";

type AuthMessage =
  | { type: "session"; accessToken: string; user: User; sessionId?: string }
  | { type: "logout-start" }
  | { type: "logout" };

const channelName = "trotot-auth-v1";
const logoutPendingKey = "trotot-auth-logout-pending";
const revisionKey = "trotot-auth-revision";
const sessionIdKey = "trotot-auth-session-id";
let channel: BroadcastChannel | null = null;

export function isLogoutPending() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(logoutPendingKey) === "1";
  } catch {
    return false;
  }
}

export function getSharedSessionId() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(sessionIdKey);
  } catch {
    return null;
  }
}

function markLogoutPending(pending: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (pending) window.localStorage.setItem(logoutPendingKey, "1");
    else window.localStorage.removeItem(logoutPendingKey);
  } catch {
    // Local state still closes; other tabs ignore messages they cannot verify.
  }
}

export function publishAuth(message: AuthMessage) {
  if (typeof window === "undefined") return;
  if (message.type === "session") markLogoutPending(false);
  else markLogoutPending(true);
  const revision = crypto.randomUUID();
  const sessionId = message.type === "session" ? message.sessionId ?? crypto.randomUUID() : null;
  try {
    // Only the opaque session identity is shared here; credentials stay in memory.
    if (sessionId) window.localStorage.setItem(sessionIdKey, sessionId);
    else window.localStorage.removeItem(sessionIdKey);
    window.localStorage.setItem(revisionKey, revision);
  } catch {
    // Other tabs ignore unverified messages; tokens remain only in memory.
  }
  if (typeof BroadcastChannel === "undefined") return;
  channel ??= new BroadcastChannel(channelName);
  channel.postMessage({ ...message, ...(sessionId ? { sessionId } : {}), revision });
}

export function subscribeAuth(onLogout: () => void) {
  if (typeof window === "undefined") return () => {};
  const apply = (message: AuthMessage) => {
    if (message?.type === "session" && message.accessToken && message.user) {
      markLogoutPending(false);
      useAuthStore.getState().setSession(message.accessToken, message.user, message.sessionId);
    } else if (message?.type === "logout-start" || message?.type === "logout") {
      markLogoutPending(true);
      useAuthStore.getState().clearSession();
      onLogout();
    }
  };
  const onMessage = (event: MessageEvent<AuthMessage & { revision: string }>) => {
    try {
      if (!event.data?.revision || event.data.revision !== window.localStorage.getItem(revisionKey)) {
        // Never apply an obsolete credential; recover a changed identity from the HttpOnly session instead.
        if (getSharedSessionId() && getSharedSessionId() !== useAuthStore.getState().sessionId && !isLogoutPending()) {
          window.dispatchEvent(new Event("trotot:shared-session"));
        }
        return;
      }
    } catch {
      return;
    }
    apply(event.data);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === logoutPendingKey && event.newValue === "1" && isLogoutPending()) apply({ type: "logout-start" });
    if (event.key === sessionIdKey && event.newValue && event.newValue === getSharedSessionId()
      && event.newValue !== useAuthStore.getState().sessionId && !isLogoutPending()) {
      window.dispatchEvent(new Event("trotot:shared-session"));
    }
  };
  if (typeof BroadcastChannel !== "undefined") {
    channel ??= new BroadcastChannel(channelName);
    channel.addEventListener("message", onMessage);
  }
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
  };
}
