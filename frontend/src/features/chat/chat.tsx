"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
export { ChatMessageContent } from "./chat-message";
const SessionChat = dynamic(() => import("./chat-widget").then(module => module.SessionChat), { ssr: false });

const ChatContext = createContext<((propertyId: string) => void) | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const auth = useAuthStore();
  const [available, setAvailable] = useState(false);
  const handler = useRef<((propertyId: string) => void) | null>(null);
  const ready = useCallback((start: ((propertyId: string) => void) | null) => { handler.current = start; setAvailable(!!start); }, []);
  const open = useCallback((propertyId: string) => { handler.current?.(propertyId); }, []);
  const allowed = auth.status === "authenticated" && auth.user?.status === "ACTIVE" && auth.user.role !== "ADMIN" && !!auth.sessionId;
  return <ChatContext.Provider value={allowed && available ? open : null}>{children}
    {allowed && <SessionChat key={`${auth.sessionId}:${auth.user!.role}`} sessionId={auth.sessionId!} userId={auth.user!.id} ready={ready} />}
  </ChatContext.Provider>;
}

export function ChatLauncher({ propertyId }: { propertyId: string }) {
  const open = useContext(ChatContext);
  const auth = useAuthStore();
  if (auth.user?.role === "ADMIN") return null;
  if (auth.status === "anonymous") return <Link className="button button-secondary" href="/login"><MessageCircle size={16} aria-hidden="true" />Chat với chủ nhà</Link>;
  return <Button variant="secondary" disabled={!open} onClick={() => open?.(propertyId)}><MessageCircle size={16} aria-hidden="true" />Chat với chủ nhà</Button>;
}
