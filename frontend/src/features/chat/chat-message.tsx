import type { ChatMessage } from "@/lib/api/chat";
import type { Ref } from "react";
const day = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" });
const clock = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
export const chatDayKey = (date: string) => day.format(new Date(date));
export function ChatDayDivider({ date }: { date: string }) {
  return <li className="py-2 text-center"><time dateTime={date} className="text-xs text-gray-600">{chatDayKey(date)}</time></li>;
}
export function ChatMessageContent({ entry, own, ref }: { entry: ChatMessage; own: boolean; ref?: Ref<HTMLLIElement> }) {
  return <li ref={ref} className={`flex flex-col gap-1 ${own ? "items-end" : "items-start"}`}>
    <p className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-base whitespace-pre-wrap [overflow-wrap:anywhere] ${own ? "bg-brand text-white" : "bg-bg text-ink"}`}>{entry.text}</p>
    <time dateTime={entry.createdAt} title={new Date(entry.createdAt).toISOString()} className="px-1 text-xs text-gray-600">{clock.format(new Date(entry.createdAt))}</time>
  </li>;
}
