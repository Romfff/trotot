import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ChatMessageContent } from "@/features/chat/chat";
import { chatDayKey, ChatDayDivider } from "@/features/chat/chat-message";
import { chronologicalMessages, type ChatMessage, type MessagePage } from "@/lib/api/chat";
const entry: ChatMessage = { id: "a", conversationId: "fixture", senderId: "guest", clientMessageId: "fixture-id", text: '<script>test</script>\n' + "long".repeat(200), createdAt: "2026-10-08T01:00:00Z" };
it.each([true, false])("escapes message HTML, wraps long content and identifies side %s", own => {
  const output = renderToStaticMarkup(<ChatMessageContent entry={entry} own={own} />);
  expect(output).not.toContain("<script>"); expect(output).toContain("&lt;script&gt;"); expect(output).toContain("overflow-wrap:anywhere"); expect(output).toContain(own ? "items-end" : "items-start"); expect(output).toContain("08:00");
  expect(output).toContain(own ? "bg-brand text-white" : "bg-bg text-ink");
});
it("groups nights at Vietnam midnight and keeps the full timestamp accessible", () => {
  expect(chatDayKey("2026-10-08T16:59:59Z")).not.toEqual(chatDayKey("2026-10-08T17:00:00Z"));
  expect(chatDayKey("2026-10-08T17:00:00Z")).toEqual(chatDayKey("2026-10-09T01:00:00Z"));
  expect(renderToStaticMarkup(<ChatDayDivider date="2026-10-08T17:00:00Z" />)).toContain("9/10/26");
  expect(renderToStaticMarkup(<ChatMessageContent entry={entry} own />)).toContain(`dateTime="${entry.createdAt}"`);
});
it("sorts newest-first cursor pages chronologically, removes overlap on refresh and keeps stable ID ties", () => {
  const page = (messages: ChatMessage[]) => ({ messages } as MessagePage);
  expect(chronologicalMessages([page([{ ...entry, id: "c" }, { ...entry, id: "b" }]), page([{ ...entry, id: "b" }, entry])]).map(m => m.id)).toEqual(["a", "b", "c"]);
  expect(chronologicalMessages([])).toEqual([]);
});
