"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const ToastContext = createContext<{ showToast: (message: string) => void }>({ showToast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function showToast(nextMessage: string) {
    if (timer.current) clearTimeout(timer.current);
    setMessage(nextMessage);
    timer.current = setTimeout(() => setMessage(""), 3500);
  }

  return <ToastContext.Provider value={{ showToast }}>
    {children}
    <div role="status" aria-live="polite" className={`fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6 left-1/2 -translate-x-1/2 w-max max-w-[calc(100vw-2rem)] bg-ink text-white px-4 py-2 rounded-lg text-sm font-medium z-50 pointer-events-none transition-opacity ${message ? "opacity-100" : "opacity-0"}`}>
      {message}
    </div>
  </ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
