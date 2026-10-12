"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, apiError } from "@/lib/api/client";
import { ApiError, type ApiEnvelope } from "@/lib/auth-types";
import { useAuthStore } from "@/stores/auth-store";

type Contact = { contactPhone: string; contactZalo: string | null };

export function ListingContact({ slug }: { slug: string }) {
  const sessionId = useAuthStore(state => state.sessionId);
  // A new session/slug mounts a fresh memory-only view; no query/localStorage cache.
  return <ContactReveal key={`${slug}:${sessionId ?? "guest"}`} slug={slug} />;
}

function ContactReveal({ slug }: { slug: string }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const reveal = async () => {
    if (busy) return;
    const { sessionId, accessToken } = useAuthStore.getState();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const response = await api.get<ApiEnvelope<Contact>>(`/properties/${encodeURIComponent(slug)}/contact`, {
        baseURL: "/api/listings", signal: controller.signal,
        // Auth's shared client attaches Bearer automatically only to its existing
        // private routes. Contact is optional-auth: forward memory token explicitly.
        ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
      });
      if (!response.data.success || typeof response.data.data?.contactPhone !== "string" || (response.data.data.contactZalo !== null && typeof response.data.data.contactZalo !== "string")) {
        throw new ApiError(502, "INVALID_BACKEND_RESPONSE", "Không đọc được thông tin liên hệ. Vui lòng thử lại.");
      }
      if (!controller.signal.aborted && sessionId === useAuthStore.getState().sessionId) setContact(response.data.data);
    } catch (failure) {
      if (!controller.signal.aborted && sessionId === useAuthStore.getState().sessionId) setError(apiError(failure).message);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };
  if (!contact) return <div className="space-y-2">
    <Button type="button" variant="secondary" className="w-full" aria-busy={busy} aria-disabled={busy} onClick={reveal}>{busy ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Phone size={16} aria-hidden="true" />}Xem số liên hệ</Button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
  const phone = contact.contactPhone?.replace(/[^\d+]/g, ""), zalo = contact.contactZalo?.replace(/\D/g, "");
  return <div className="flex flex-col gap-3">
    {phone && <a href={`tel:${phone}`} className="button"><Phone size={16} aria-hidden="true" /><span>Gọi {phone}</span></a>}
    {zalo && <a href={`https://zalo.me/${zalo}`} target="_blank" rel="noopener noreferrer" className="button button-secondary">Chat Zalo</a>}
    {!phone && !zalo && <p className="text-sm text-gray-600">Chưa có thông tin liên hệ.</p>}
  </div>;
}
