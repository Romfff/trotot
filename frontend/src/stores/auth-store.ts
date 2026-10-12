import { create } from "zustand";
import type { User } from "@/lib/auth-types";

type AuthStatus = "initializing" | "authenticated" | "anonymous" | "unavailable";
type AuthState = {
  sessionId: string | null;
  accessToken: string | null;
  user: User | null;
  status: AuthStatus;
  setSession: (accessToken: string, user: User, sessionId?: string) => void;
  setAccessToken: (accessToken: string) => void;
  setStatus: (status: AuthStatus) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  sessionId: null,
  accessToken: null,
  user: null,
  status: "initializing",
  // Login creates a new identity, even if the account and token are unchanged.
  // Refresh/broadcast updates explicitly retain the current session identity.
  setSession: (accessToken, user, sessionId = crypto.randomUUID()) => set({ sessionId, accessToken, user, status: "authenticated" }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setStatus: (status) => set({ status }),
  clearSession: () => set({ sessionId: null, accessToken: null, user: null, status: "anonymous" }),
}));
