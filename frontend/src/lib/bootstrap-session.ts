import { getSharedSessionId, isLogoutPending } from "@/lib/auth-channel";
import type { QueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api/client";
import { ApiError } from "@/lib/auth-types";
import { useAuthStore } from "@/stores/auth-store";

// Private by default. Removing an observed public query can strand it in "pending".
export function clearSessionCache(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (query) => query.meta?.public !== true });
  queryClient.getMutationCache().clear();
}

export async function bootstrapSession(queryClient: QueryClient, isActive: () => boolean) {
  let session = useAuthStore.getState();
  try {
    await authApi.refresh();
    session = useAuthStore.getState();
    if (!isActive() || !session.accessToken) return;
    const user = await authApi.me();
    // Logout, another login, or a newer refresh makes this response obsolete.
    if (!isActive() || useAuthStore.getState() !== session) return;
    session.setSession(session.accessToken, user, session.sessionId ?? undefined);
    queryClient.setQueryData(["auth", "me"], user);
  } catch (error) {
    if (!isActive() || useAuthStore.getState() !== session) return;
    session.clearSession();
    // Only confirmed invalid/closed sessions imply anonymous. Server, network,
    // quota and unexpected failures do not prove the HttpOnly session is gone.
    const unavailable = !(error instanceof ApiError
      && (error.status === 401 || ["SESSION_CLOSED", "SESSION_CHANGED"].includes(error.errorCode)));
    useAuthStore.getState().setStatus(unavailable ? "unavailable" : "anonymous");
  }
}

// Storage carries only an opaque identity. Read user/role/token from the server, never from storage.
export function createSharedSessionSynchronizer(queryClient: QueryClient, isActive: () => boolean) {
  let synchronizing = false;
  return async function synchronize(): Promise<void> {
    const sharedId = getSharedSessionId();
    if (!isActive() || !sharedId || isLogoutPending() || synchronizing || useAuthStore.getState().sessionId === sharedId) return;
    synchronizing = true;
    clearSessionCache(queryClient);
    useAuthStore.getState().clearSession();
    useAuthStore.getState().setStatus("initializing");
    try { await bootstrapSession(queryClient, isActive); }
    finally {
      synchronizing = false;
      // A new login may have arrived during this attempt. Do not retry a failed unchanged identity.
      if (isActive() && getSharedSessionId() && getSharedSessionId() !== sharedId) void synchronize();
    }
  };
}
