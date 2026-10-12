"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { appointmentsApi } from "@/lib/api/appointments";
import { apiError } from "@/lib/api/client";
import { useAuthStore } from "@/stores/auth-store";
import { anotherFloatingPanelIsOpen, closeFloatingPanels, useFloatingPanel } from "@/stores/floating-panel-store";
import styles from "./notification-bell.module.css";

export function NotificationBadge({ count }: { count: number | undefined }) {
  if (!count || count < 0) return null;
  return <span aria-hidden="true" data-testid="notification-badge" className={count === 1 ? styles.dot : styles.badge}>{count === 1 ? null : count > 9 ? "9+" : count}</span>;
}

export function NotificationBell() {
  const { user, status, sessionId } = useAuthStore();
  // The existing appointment notification contract only permits active Tenant/Host.
  if (status !== "authenticated" || !sessionId || user?.status !== "ACTIVE" || (user.role !== "TENANT" && user.role !== "HOST")) return null;
  return <SessionNotificationBell key={sessionId} sessionId={sessionId} host={user.role === "HOST"} />;
}

function SessionNotificationBell({ sessionId, host }: { sessionId: string; host: boolean }) {
  const router = useRouter();
  const cache = useQueryClient();
  const { open, setOpen } = useFloatingPanel("notifications");
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const current = () => mounted.current && useAuthStore.getState().sessionId === sessionId && useAuthStore.getState().status === "authenticated";
  useEffect(() => {
    mounted.current = true;
    const media = window.matchMedia("(min-width: 768px)");
    const resize = () => { if (!media.matches) setOpen(false); };
    media.addEventListener("change", resize);
    return () => { mounted.current = false; media.removeEventListener("change", resize); };
  }, [setOpen]);

  // Share the notifications page's cache and action invalidations. No polling.
  const list = useQuery({
    queryKey: ["appointment-notifications", sessionId, 1],
    queryFn: ({ signal }) => appointmentsApi.notifications(1, signal),
    retry: false,
    refetchOnWindowFocus: "always",
  });
  const read = useMutation({
    mutationFn: appointmentsApi.markRead,
    onSuccess: async () => {
      if (!current()) return;
      await cache.invalidateQueries({ queryKey: ["appointment-notifications", sessionId] });
      if (!current()) return;
      setOpen(false);
      router.push(host ? "/host/appointments" : "/my-appointments");
    },
  });
  const count = list.data?.meta.unreadCount;
  const label = count === undefined ? "Thông báo" : `Thông báo, ${count} chưa đọc`;

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="plain" size="icon" className={styles.trigger} aria-label={label} title="Thông báo lịch xem trọ" onClick={(event) => {
        if (!window.matchMedia("(min-width: 768px)").matches) {
          // Prevent Radix opening a desktop popup; mobile uses the existing page.
          event.preventDefault();
          closeFloatingPanels();
          router.push("/notifications");
        }
      }}><Bell size={20} aria-hidden="true" /><NotificationBadge count={count} /></Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={18} className={styles.panel} aria-labelledby={titleId} onOpenAutoFocus={(event) => { event.preventDefault(); heading.current?.focus(); }} onCloseAutoFocus={(event) => { if (anotherFloatingPanelIsOpen("notifications")) event.preventDefault(); }}>
      <header className={styles.header}>
        <h2 id={titleId} ref={heading} tabIndex={-1}>Thông báo</h2>
        <p>Lịch xem trọ của bạn</p>
      </header>
      <div className={styles.list} aria-busy={list.isFetching || read.isPending}>
        {list.isPending && <div className={styles.state} role="status">Đang tải thông báo…</div>}
        {list.isError && <div className={styles.state} role="alert"><p>{apiError(list.error).message}</p><Button variant="secondary" disabled={list.isFetching} onClick={() => void list.refetch()}><RotateCw size={16} aria-hidden="true" />Thử lại</Button></div>}
        {read.isError && <div className={styles.state} role="alert"><p>{apiError(read.error).message}</p><Button variant="secondary" disabled={read.isPending} onClick={() => read.mutate(read.variables!)}>Thử đánh dấu đã đọc lại</Button></div>}
        {read.isPending && <p className="sr-only" role="status">Đang đánh dấu đã đọc…</p>}
        {list.data && (list.data.data.length === 0 ? <p className={styles.state}>Chưa có thông báo</p> : <ul aria-label="Thông báo mới nhất">
          {list.data.data.slice(0, 8).map((notice) => <li key={notice.id}>
            <button type="button" className={styles.item} disabled={read.isPending} onClick={() => read.mutate(notice.id)}>
              <span className={styles.unreadSlot}>{!notice.readAt && <span className={styles.unread} aria-label="Chưa đọc" />}</span>
              <span className={styles.content}>
                <span className={notice.readAt ? styles.readMessage : styles.message} title={notice.message}>{notice.message}</span>
                <time dateTime={notice.createdAt}>{new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(notice.createdAt))}</time>
              </span>
            </button>
          </li>)}
        </ul>)}
      </div>
      <footer className={styles.footer}><Link href="/notifications" onClick={() => setOpen(false)}>Xem tất cả</Link></footer>
    </PopoverContent>
  </Popover>;
}
