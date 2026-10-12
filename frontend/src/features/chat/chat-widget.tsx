"use client";
import { Fragment, useCallback, useEffect, useId, useRef, useState, type FormEvent, type Ref, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ChevronLeft, ChevronRight, LoaderCircle, MessageCircle, RotateCw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuthStore } from "@/stores/auth-store";
import { anotherFloatingPanelIsOpen, useFloatingPanel } from "@/stores/floating-panel-store";
import { chatApi, chronologicalMessages } from "@/lib/api/chat";
import { subscribeChatRealtime } from "@/lib/chat-realtime";
import { ChatMessageContent, chatDayKey, ChatDayDivider } from "./chat-message";
import styles from "./chat.module.css";
const message = (error: unknown) => error instanceof Error ? error.message : "Chưa kết nối được cuộc trò chuyện. Vui lòng thử lại.";

function ChatHeader({ titleId, heading, name, children, back, close, retry }: { titleId: string; heading: Ref<HTMLHeadingElement>; name: string; children?: ReactNode; back?: () => void; close: () => void; retry?: () => void }) {
  return <header className="flex shrink-0 items-start gap-2 border-b border-gray-200 px-3 py-3">
    {back && <Button variant="plain" size="icon" className={styles.headerButton} aria-label="Về danh sách tin nhắn" title="Về danh sách tin nhắn" onClick={back}><ArrowLeft size={18} aria-hidden="true" /></Button>}
    <div className="min-w-0 flex-1 py-2">
      <h2 id={titleId} ref={heading} tabIndex={-1} className="line-clamp-2 text-base font-semibold [overflow-wrap:anywhere]" title={name}>{name}</h2>
      {children}
    </div>
    <div className="flex shrink-0">
      {retry && <Button variant="plain" size="icon" className={styles.headerButton} aria-label="Tải lại tin nhắn" title="Tải lại tin nhắn" onClick={retry}><RotateCw size={18} aria-hidden="true" /></Button>}
      <Button variant="plain" size="icon" className={styles.headerButton} aria-label="Đóng tin nhắn" title="Đóng tin nhắn" onClick={close}><X size={18} aria-hidden="true" /></Button>
    </div>
  </header>;
}

function ChatLoading() {
  return <div aria-busy="true" className="space-y-4 py-4">
    <span className="sr-only" role="status">Đang tải cuộc trò chuyện</span>
    <div aria-hidden="true" className="space-y-4 animate-pulse motion-reduce:animate-none">
      {["w-2/3", "w-1/2", "w-3/4", "w-2/3"].map((width, index) => <div key={index} className={`h-14 rounded-xl bg-bg ${width}`} />)}
    </div>
  </div>;
}
function ChatError({ error, retry }: { error: unknown; retry: () => void }) {
  return <div role="alert" className="space-y-3 py-4"><p className="text-sm text-error [overflow-wrap:anywhere]">{message(error)}</p><Button variant="secondary" onClick={retry}><RotateCw size={16} aria-hidden="true" />Thử lại</Button></div>;
}

export function SessionChat({ sessionId, userId, ready }: { sessionId: string; userId: string; ready: (start: ((propertyId: string) => void) | null) => void }) {
  const client = useQueryClient();
  const { open, setOpen } = useFloatingPanel("chat");
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [connected, setConnected] = useState(false);
  const pendingProperty = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = useCallback(() => mounted.current && useAuthStore.getState().sessionId === sessionId && useAuthStore.getState().status === "authenticated", [sessionId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const visual = window.visualViewport;
    // Mobile keyboards shrink the visual viewport, not necessarily the layout viewport.
    const resize = () => {
      panel.current?.style.setProperty("--chat-viewport-height", `${visual.height}px`);
      panel.current?.style.setProperty("--chat-viewport-top", `${visual.offsetTop}px`);
    };
    resize(); visual.addEventListener("resize", resize); visual.addEventListener("scroll", resize);
    return () => { visual.removeEventListener("resize", resize); visual.removeEventListener("scroll", resize); };
  }, [open]);
  const list = useQuery({ queryKey: ["chat-conversations", sessionId, page], queryFn: ({ signal }) => chatApi.list(page, signal), enabled: open && !selected && !creating, retry: false, refetchOnWindowFocus: true });
  const unread = useQuery({ queryKey: ["chat-unread", sessionId], queryFn: ({ signal }) => chatApi.unread(signal), retry: false, refetchOnWindowFocus: true });
  useEffect(() => subscribeChatRealtime(null, conversationId => {
    void client.invalidateQueries({ queryKey: ["chat-unread", sessionId] });
    void client.invalidateQueries({ queryKey: ["chat-conversations", sessionId] });
    void client.invalidateQueries({ queryKey: conversationId ? ["chat-messages", sessionId, conversationId] : ["chat-messages", sessionId] });
  }, setConnected), [client, sessionId]);
  const start = useCallback(async (propertyId: string) => {
    if (!current()) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    pendingProperty.current = propertyId;
    setOpen(true); setSelected(null); setCreating(true); setError(null);
    try {
      const conversation = await chatApi.open(propertyId, controller.signal);
      if (!current() || request.current !== controller) return;
      pendingProperty.current = null; setSelected(conversation.id);
      void client.invalidateQueries({ queryKey: ["chat-conversations", sessionId] });
    } catch (failure) { if (current() && request.current === controller && !controller.signal.aborted) setError(failure); }
    finally { if (current() && request.current === controller) setCreating(false); }
  }, [client, current, sessionId, setOpen]);
  useEffect(() => { ready(propertyId => void start(propertyId)); return () => ready(null); }, [ready, start]);
  return <div className="chat-anchor">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button variant="secondary" className="chat-trigger relative" aria-label="Mở tin nhắn" aria-describedby={unread.data?.totalUnread ? `${titleId}-unread` : undefined} onClick={event => { trigger.current = event.currentTarget; }}><MessageCircle size={20} aria-hidden="true" />Tin nhắn{Boolean(unread.data?.totalUnread) && <><span data-testid="chat-unread-dot" aria-hidden="true" className="absolute right-2 top-2 size-2 rounded-full bg-error" /><span id={`${titleId}-unread`} className="sr-only">Có {unread.data?.totalUnread} tin nhắn chưa đọc</span></>}</Button></PopoverTrigger>
        <PopoverContent ref={panel} align="end" side="top" sideOffset={selected ? 8 : 6} className={`${styles.panel} ${selected ? "" : styles.listPanel}`} aria-labelledby={titleId}
          onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }}
          onCloseAutoFocus={event => { if (anotherFloatingPanelIsOpen("chat")) event.preventDefault(); else if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus(); } }}
          onInteractOutside={event => { event.preventDefault(); }}>
          {selected ? <ChatThread key={selected} id={selected} sessionId={sessionId} userId={userId} open={open} connected={connected} titleId={titleId} heading={heading} back={() => { setSelected(null); setError(null); }} close={() => setOpen(false)} /> : <>
          <ChatHeader titleId={titleId} heading={heading} name="Tin nhắn" close={() => setOpen(false)} />
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {creating ? <ChatLoading /> : error ? <ChatError error={error} retry={() => { if (pendingProperty.current) void start(pendingProperty.current); }} /> : <>
              {list.isPending && <ChatLoading />}
              {list.error && <ChatError error={list.error} retry={() => void list.refetch()} />}
              {list.data && <>
                {list.data.data.length === 0 && <p className="py-6 text-sm text-gray-600">Chọn “Chat với chủ nhà” trên tin để bắt đầu.</p>}
                <ul className={styles.conversations}>{list.data.data.map(conversation => {
                  const name = conversation.guest.id === userId ? conversation.host.fullName : conversation.guest.fullName;
                  return <li key={conversation.id}>
                    <button className={styles.conversationRow} onClick={() => setSelected(conversation.id)}>
                      <span className={styles.avatar} aria-hidden="true">{name.trim().charAt(0).toLocaleUpperCase("vi-VN")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2"><span className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold [overflow-wrap:anywhere]" title={name}>{name}</span>{unread.data?.conversations.some(row => row.conversationId === conversation.id && row.unreadCount > 0) && <span className="size-2 shrink-0 rounded-full bg-error"><span className="sr-only">Có tin nhắn chưa đọc</span></span>}</span>
                        <span className="mt-1 block line-clamp-2 text-xs text-gray-600 [overflow-wrap:anywhere]" title={conversation.title}>{conversation.title}</span>
                        {!conversation.canSend && <span className="mt-1 block text-xs text-gray-600">Chỉ đọc</span>}
                      </span>
                    </button>
                  </li>;
                })}</ul>
                {list.data.meta.totalPages > 1 && <nav className="mt-4 flex items-center justify-between gap-2" aria-label="Phân trang cuộc trò chuyện">
                  <Button variant="secondary" size="icon" disabled={page <= 1} aria-label="Trang tin nhắn trước" onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></Button>
                  <span className="text-xs tabular-nums">{page}/{list.data.meta.totalPages}</span>
                  <Button variant="secondary" size="icon" disabled={page >= list.data.meta.totalPages} aria-label="Trang tin nhắn sau" onClick={() => setPage(page + 1)}><ChevronRight size={16} /></Button>
                </nav>}
              </>}
            </>}
          </div></>}
        </PopoverContent>
      </Popover>
    </div>;
}

function ChatThread({ id, sessionId, userId, open, connected, titleId, heading, back, close }: { id: string; sessionId: string; userId: string; open: boolean; connected: boolean; titleId: string; heading: Ref<HTMLHeadingElement>; back: () => void; close: () => void }) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const inputId = useId();
  const pending = useRef<{ clientMessageId: string; text: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const lastMessage = useRef<HTMLLIElement>(null);
  const followLatest = useRef(true);
  const readCursor = useRef<string | null>(null);
  const key = ["chat-messages", sessionId, id];
  const current = () => mounted.current && useAuthStore.getState().sessionId === sessionId && useAuthStore.getState().status === "authenticated";
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const history = useInfiniteQuery({ queryKey: key, initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => chatApi.messages(id, pageParam, signal), getNextPageParam: last => last.nextCursor ?? undefined,
    enabled: open, retry: false, refetchOnWindowFocus: true });
  const conversation = history.data?.pages[0].conversation;
  const entries = chronologicalMessages(history.data?.pages || []);
  const latestId = entries.at(-1)?.id;
  useEffect(() => {
    const root = viewport.current;
    if (!root || !open) return;
    const observer = new ResizeObserver(() => { if (followLatest.current) root.scrollTop = root.scrollHeight; });
    observer.observe(root); return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    const fit = () => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; };
    fit(); let width = input.clientWidth;
    const observer = new ResizeObserver(() => { if (width !== input.clientWidth) { width = input.clientWidth; fit(); } });
    observer.observe(input); return () => observer.disconnect();
  }, [text, conversation?.canSend]);
  useEffect(() => {
    const root = viewport.current;
    if (!open || !root) return;
    if (followLatest.current) { root.scrollTop = root.scrollHeight; setHasNewMessages(false); }
    else if (latestId) setHasNewMessages(true);
  }, [latestId, open]);
  useEffect(() => {
    const root = viewport.current, last = lastMessage.current;
    if (!open || !latestId || !root || !last) return;
    const controller = new AbortController();
    let visible = false, writing = false;
    const mark = async () => {
      if (!visible || document.visibilityState !== "visible" || readCursor.current === latestId || writing || !mounted.current
        || useAuthStore.getState().sessionId !== sessionId || useAuthStore.getState().status !== "authenticated") return;
      writing = true;
      try {
        await chatApi.markRead(id, latestId, controller.signal);
        if (!controller.signal.aborted && useAuthStore.getState().sessionId === sessionId) {
          readCursor.current = latestId;
          void client.invalidateQueries({ queryKey: ["chat-unread", sessionId] });
        }
      } catch { /* Failed reads keep the authoritative unread indicator. */ }
      finally { writing = false; }
    };
    const observer = new IntersectionObserver(records => { visible = records.some(record => record.isIntersecting && record.intersectionRatio >= 0.1); void mark(); }, { root, threshold: 0.1 });
    const visibility = () => void mark();
    observer.observe(last); document.addEventListener("visibilitychange", visibility);
    return () => { controller.abort(); observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, [client, id, latestId, open, sessionId]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current || !current() || !conversation?.canSend) return;
    const value = text.trim();
    if (!value || value.length > 3000) { setError(new Error("Tin nhắn phải có nội dung và tối đa 3000 ký tự.")); textarea.current?.focus(); return; }
    if (!pending.current || pending.current.text !== value) pending.current = { clientMessageId: crypto.randomUUID(), text: value };
    const controller = new AbortController(); request.current = controller; setSending(true); setError(null);
    try {
      await chatApi.send(id, pending.current, controller.signal);
      if (!current()) return;
      pending.current = null; setText("");
      followLatest.current = true;
      void client.invalidateQueries({ queryKey: key, exact: true });
      textarea.current?.focus();
    } catch (failure) {
      if (!current() || controller.signal.aborted) return;
      setError(failure); // Keep the draft and message UUID for a safe retry.
      void client.invalidateQueries({ queryKey: key, exact: true });
    } finally { request.current = null; if (current()) setSending(false); }
  }
  return <>
    <ChatHeader titleId={titleId} heading={heading} name={conversation ? (conversation.guest.id === userId ? conversation.host.fullName : conversation.guest.fullName) : "Cuộc trò chuyện"} back={back} close={close} retry={() => void history.refetch()}>
      <div className="mt-1 space-y-1 text-xs text-gray-600">
        <p className="line-clamp-2 [overflow-wrap:anywhere]" title={conversation?.title}>Tin: {conversation?.title || "Đang tải tin"}</p>
        <span role="status" className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${connected ? "bg-brand" : "bg-gray-600"}`} />{connected ? "Đã kết nối" : "Chưa kết nối realtime"}</span>
      </div>
    </ChatHeader>
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={viewport} onScroll={event => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; if (followLatest.current) setHasNewMessages(false); }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" aria-busy={history.isFetching}>
      {history.isPending && <ChatLoading />}
      {history.error && <ChatError error={history.error} retry={() => void history.refetch()} />}
      {history.hasNextPage && <Button variant="secondary" className="mb-4 w-full" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>Xem tin nhắn trước</Button>}
      {history.data && !history.error && entries.length === 0 && <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 text-center">
        <MessageCircle size={28} className="mb-1 text-gray-600" aria-hidden="true" />
        <p className="text-sm font-medium">Chưa có tin nhắn</p>
        <p className="max-w-64 text-sm text-gray-600 text-pretty">{conversation?.canSend ? "Trao đổi về phòng, giá hoặc lịch xem." : "Lịch sử cuộc trò chuyện sẽ hiển thị tại đây."}</p>
      </div>}
      <ol className="space-y-3" aria-label="Lịch sử tin nhắn">{entries.map((entry, index) => <Fragment key={entry.id}>
        {(index === 0 || chatDayKey(entry.createdAt) !== chatDayKey(entries[index - 1].createdAt)) && <ChatDayDivider date={entry.createdAt} />}
        <ChatMessageContent ref={entry.id === latestId ? lastMessage : undefined} entry={entry} own={entry.senderId === userId} />
      </Fragment>)}</ol>
    </div>
    {hasNewMessages && <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"><Button variant="secondary" className="pointer-events-auto rounded-full" onClick={() => { const root = viewport.current; if (root) root.scrollTop = root.scrollHeight; followLatest.current = true; setHasNewMessages(false); }}><ArrowDown size={16} aria-hidden="true" />Tin mới</Button></div>}
    </div>
    <form onSubmit={send} className={`${styles.footer} shrink-0 space-y-2 border-t border-gray-200 p-3`}>
      {!!error && <p role="alert" className="text-sm text-error [overflow-wrap:anywhere]">{message(error)}</p>}
      {conversation && !conversation.canSend ? <p role="status" className="text-sm text-gray-600">{conversation.readOnlyReason || "Cuộc trò chuyện chỉ đọc."}</p> : <>
        <div className={styles.composer}>
        <textarea ref={textarea} id={inputId} name="chatMessage" aria-label="Tin nhắn" aria-describedby={text.length >= 2700 ? `${inputId}-count` : undefined} placeholder="Nhập tin nhắn…" rows={1} maxLength={3000} className="min-w-0 flex-1 resize-none text-base" value={text} disabled={!conversation || sending}
          onChange={event => setText(event.target.value)} />
        <Button type="submit" size="icon" aria-label="Gửi" title="Gửi tin nhắn" aria-busy={sending} aria-disabled={sending} disabled={!conversation || !text.trim()} className={styles.sendButton} onClick={event => { if (sending) event.preventDefault(); }}>{sending ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}</Button>
        </div>
        {text.length >= 2700 && <p id={`${inputId}-count`} className="text-right text-xs tabular-nums text-gray-600">{text.length}/3000</p>}
      </>}
    </form>
  </>;
}
