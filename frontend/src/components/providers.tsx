"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { subscribeAuth } from "@/lib/auth-channel";
import { bootstrapSession, clearSessionCache, createSharedSessionSynchronizer } from "@/lib/bootstrap-session";
import { useAuthStore } from "@/stores/auth-store";

function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } } }));

  useEffect(() => {
    let active = true;
    const unsubscribeStore = useAuthStore.subscribe((state, previous) => {
      if (state.user?.id !== previous.user?.id || state.user?.role !== previous.user?.role) clearSessionCache(queryClient);
    });
    const unsubscribe = subscribeAuth(() => clearSessionCache(queryClient));
    const synchronizeSharedSession = createSharedSessionSynchronizer(queryClient, () => active);
    const onSharedSession = () => { void synchronizeSharedSession(); };
    const onLogout = () => clearSessionCache(queryClient);
    const onSessionExpired = () => {
      clearSessionCache(queryClient);
      router.replace("/login?sessionExpired=1");
    };
    const onRetrySession = () => {
      if (useAuthStore.getState().status !== "unavailable") return;
      useAuthStore.getState().setStatus("initializing");
      void bootstrapSession(queryClient, () => active);
    };
    window.addEventListener("trotot:shared-session", onSharedSession);
    window.addEventListener("trotot:logout", onLogout);
    window.addEventListener("trotot:session-expired", onSessionExpired);
    window.addEventListener("trotot:retry-session", onRetrySession);
    void bootstrapSession(queryClient, () => active);
    return () => {
      active = false;
      unsubscribeStore();
      unsubscribe();
      window.removeEventListener("trotot:shared-session", onSharedSession);
      window.removeEventListener("trotot:logout", onLogout);
      window.removeEventListener("trotot:session-expired", onSessionExpired);
      window.removeEventListener("trotot:retry-session", onRetrySession);
    };
  }, [queryClient, router]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <SessionBootstrap>{children}</SessionBootstrap>;
}
