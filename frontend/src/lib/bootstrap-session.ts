import type { QueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api/client";
import { ApiError } from "@/lib/auth-types";
import { useAuthStore } from "@/stores/auth-store";

export async function bootstrapSession(queryClient: QueryClient, isActive: () => boolean) {
  let session = useAuthStore.getState();
  try {
    await authApi.refresh();
    session = useAuthStore.getState();
    if (!isActive() || !session.accessToken) return;
    const user = await authApi.me();
    // Logout, another login, or a newer refresh makes this response obsolete.
    if (!isActive() || useAuthStore.getState() !== session) return;
    session.setSession(session.accessToken, user);
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
