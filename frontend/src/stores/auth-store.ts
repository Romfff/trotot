import { create } from "zustand";
import type { User } from "@/lib/auth-types";

type AuthStatus = "initializing" | "authenticated" | "anonymous" | "unavailable";
type AuthState = {
  accessToken: string | null;
  user: User | null;
  status: AuthStatus;
  setSession: (accessToken: string, user: User) => void;
  setAccessToken: (accessToken: string) => void;
  setStatus: (status: AuthStatus) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: "initializing",
  setSession: (accessToken, user) => set({ accessToken, user, status: "authenticated" }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setStatus: (status) => set({ status }),
  clearSession: () => set({ accessToken: null, user: null, status: "anonymous" }),
}));
