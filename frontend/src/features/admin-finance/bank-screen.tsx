"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LoaderCircle, RotateCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiError } from "@/lib/api/client";
import { adminBankApi, type BankReview } from "@/lib/api/admin-bank";
import { bankNeedsReplay } from "@/features/host-finance/bank-form";
import { useAuthStore } from "@/stores/auth-store";
import { reviewFieldErrors } from "./bank-review";
import './stitch-finance-batch.css';

const labels = { PENDING: "Chờ xác minh", VERIFIED: "Đã xác minh", REJECTED: "Đã từ chối" };
const dateLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
function ReadError({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="space-y-3 py-4"><Alert>{apiError(error).message}</Alert>
    <Button variant="secondary" onClick={retry}><RotateCw className="size-4" aria-hidden="true" />Thử lại tải dữ liệu</Button></div>;
}
function Loading() {
  return <div role="status" aria-label="Đang tải ngân hàng" aria-busy="true" className="space-y-3 py-4">
    <span className="sr-only">Đang tải ngân hàng</span>{[1, 2, 3].map(key => <div key={key} aria-hidden="true" className="h-5 w-2/3 rounded bg-gray-200 motion-safe:animate-pulse" />)}
  </div>;
}
export function AdminBankScreen() {
  const { user, status, sessionId } = useAuthStore();
  return <div className="admin-finance-batch mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold">Xác minh ngân hàng chủ nhà</h1>
      <p className="mt-2 max-w-[70ch] text-sm text-gray-600 text-pretty">Kiểm tra chủ sở hữu và chứng cứ trước khi xác minh. Đây không phải thao tác chuyển tiền.</p></header>
    {status === "initializing" ? <Loading /> : status === "unavailable" ? <Alert>Chưa kiểm tra được phiên đăng nhập. Hãy tải lại trang.</Alert>
      : !user ? <p><Link className="text-link underline underline-offset-4" href="/login">Đăng nhập</Link> để xem trang quản trị.</p>
      : user.role !== "ADMIN" || user.status !== "ACTIVE" || !sessionId ? <Alert>Trang này chỉ dành cho Admin đang hoạt động.</Alert>
      : <BankAccounts key={sessionId} sessionId={sessionId} />}
  </div>;
}
function BankAccounts({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState(1), [selected, setSelected] = useState<string | null>(null), [locked, setLocked] = useState(false);
  const list = useQuery({ queryKey: ["admin-bank-list", sessionId, page], queryFn: ({ signal }) => adminBankApi.list(page, signal),
    retry: false, gcTime: 0, refetchOnWindowFocus: true });
  return <div className="finance-review-grid">
    <section aria-labelledby="admin-bank-list-title" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="admin-bank-list-title" className="text-base font-semibold">Tài khoản đã gửi</h2>
        <Button variant="secondary" disabled={list.isFetching || locked} onClick={() => void list.refetch()}><RotateCw className="size-4" aria-hidden="true" />Tải lại danh sách</Button></div>
      {list.isError ? <ReadError error={list.error} retry={() => void list.refetch()} /> : !list.data ? <Loading />
        : <div aria-busy={list.isFetching}>
          {list.data.data.length === 0 ? <p className="py-6 text-sm text-gray-600">Chưa có tài khoản ở trang này.</p>
            : <ul className="finance-list mt-4 divide-y divide-gray-200">{list.data.data.map(row => <li key={row.id} className="finance-row flex flex-wrap items-center justify-between gap-3 py-4" data-selected={selected === row.id}>
              <div className="min-w-0 space-y-1"><h3 className="text-sm font-medium">{row.bankCode} · {row.accountNumber}</h3>
                <p className="finance-status text-sm text-gray-600">{labels[row.status]} · {row.isCurrent ? "Bản hiện tại" : "Bản cũ, không được duyệt"}</p>
                <p className="font-mono text-xs text-gray-600 wrap-anywhere">Host: {row.hostId}</p>
                <p className="text-xs text-gray-600">Gửi lúc {dateLabel(row.createdAt)}</p></div>
              <Button variant="secondary" disabled={locked} aria-pressed={selected === row.id} aria-controls="admin-bank-detail"
                onClick={() => setSelected(row.id)}>Xem tài khoản</Button>
            </li>)}</ul>}
          {list.data.meta.totalPages > 1 ? <nav aria-label="Phân trang ngân hàng" className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" size="icon" aria-label="Ngân hàng trang trước" disabled={locked || list.isFetching || page <= 1}
              onClick={() => { setSelected(null); setPage(page - 1); }}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
            <span className="text-sm tabular-nums" aria-current="page">{page} / {list.data.meta.totalPages}</span>
            <Button variant="secondary" size="icon" aria-label="Ngân hàng trang sau" disabled={locked || list.isFetching || page >= list.data.meta.totalPages}
              onClick={() => { setSelected(null); setPage(page + 1); }}><ChevronRight className="size-4" aria-hidden="true" /></Button>
          </nav> : null}
        </div>}
    </section>
    <section id="admin-bank-detail" aria-labelledby="admin-bank-detail-title" className="finance-detail rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 id="admin-bank-detail-title" className="text-base font-semibold">Chi tiết và xác minh</h2>
      {selected ? <BankDetail key={selected} id={selected} sessionId={sessionId} setLocked={setLocked} />
        : <p className="mt-4 text-sm text-gray-600">Chọn một tài khoản để kiểm tra thông tin.</p>}
    </section>
  </div>;
}
function BankDetail({ id, sessionId, setLocked }: { id: string; sessionId: string; setLocked: (value: boolean) => void }) {
  const client = useQueryClient(), form = useRef<HTMLFormElement>(null), inFlight = useRef(false);
  const key = ["admin-bank-detail", sessionId, id];
  const detail = useQuery({ queryKey: key, queryFn: ({ signal }) => adminBankApi.detail(id, signal), retry: false, gcTime: 0, refetchOnWindowFocus: true });
  const [fields, setFields] = useState({ reason: "", evidenceNote: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof fields, string>>>({});
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(""), [saved, setSaved] = useState(false);
  const attempt = useRef<{ action: "verify" | "reject"; body: BankReview; key: string } | null>(null);
  const current = () => {
    const state = useAuthStore.getState();
    return state.sessionId === sessionId && state.status === "authenticated" && state.user?.role === "ADMIN" && state.user.status === "ACTIVE";
  };
  async function review(action: "verify" | "reject") {
    if (inFlight.current || !current()) return;
    if (!attempt.current) {
      if (!detail.data || detail.isError || detail.isFetching || !detail.data.isCurrent || detail.data.status !== "PENDING" || detail.data.version >= 2147483647) return;
      const invalid = reviewFieldErrors(fields); setErrors(invalid);
      const first = Object.keys(invalid)[0];
      if (first) { form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus(); return; }
      attempt.current = { action, body: { ...fields, expectedVersion: detail.data.version }, key: crypto.randomUUID() };
    }
    const sent = attempt.current;
    inFlight.current = true; setBusy(true); setLocked(true); setSaved(false); setMessage("");
    try {
      await adminBankApi.review(id, sent.action, sent.body, sent.key);
      if (!current()) return;
      attempt.current = null; setUncertain(false); setLocked(false); setSaved(true); setFields({ reason: "", evidenceNote: "" });
      await client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ["admin-bank-list", sessionId] });
    } catch (failure) {
      if (!current()) return;
      const error = apiError(failure), replay = bankNeedsReplay(error);
      setUncertain(replay); setLocked(replay); setErrors(error.fieldErrors);
      setMessage(replay ? "Chưa rõ kết quả xử lý. Giữ nguyên thông tin và thử lại cùng yêu cầu; không chuyển sang tài khoản khác." : error.message);
      if (!replay) attempt.current = null;
      if (["STALE_BANK_VERSION", "BANK_SUPERSEDED", "BANK_ALREADY_REVIEWED"].includes(error.errorCode)) {
        void detail.refetch(); void client.invalidateQueries({ queryKey: ["admin-bank-list", sessionId] });
      }
    } finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  const row = detail.data;
  const mayReview = row?.isCurrent && row.status === "PENDING" && row.version < 2147483647 && !detail.isError && !detail.isFetching;
  return <div className="mt-4 space-y-5">
    {detail.isError ? <ReadError error={detail.error} retry={() => void detail.refetch()} /> : !row ? <Loading />
      : <div aria-busy={detail.isFetching}>
        <dl className="finance-snapshot @container space-y-3 text-sm">{[["Host", row.hostId], ["Ngân hàng", row.bankCode], ["Số tài khoản", row.accountNumber], ["Chủ tài khoản", row.accountName],
          ["Trạng thái", `${labels[row.status]} · ${row.isCurrent ? "Bản hiện tại" : "Bản cũ"}`]].map(([label, value]) => <div key={label} className="grid gap-1 @sm:grid-cols-[10rem_minmax(0,1fr)] @sm:gap-4">
            <dt className="text-gray-600">{label}</dt><dd className="min-w-0 font-medium wrap-anywhere">{value}</dd></div>)}</dl>
        {!mayReview ? <p className="mt-4 text-sm text-gray-600">Tài khoản này hiện không thể xác minh hoặc từ chối. Máy chủ vẫn kiểm tra lại phiên bản khi xử lý.</p> : null}
        <h3 className="mt-5 text-sm font-medium">Lịch sử kiểm tra</h3>
        <ul className="finance-timeline mt-3 divide-y divide-gray-200 text-sm">{row.events.map(event => <li key={event.id} className="space-y-1 py-3">
          <p className="font-medium">{event.action === "SUBMITTED" ? "Host gửi tài khoản" : labels[event.action]} · {dateLabel(event.createdAt)}</p>
          <p className="text-gray-600 wrap-anywhere">Lý do: {event.reason}</p><p className="text-gray-600 wrap-anywhere">Chứng cứ: {event.evidenceNote}</p>
          <p className="font-mono text-xs text-gray-600 wrap-anywhere">Người xử lý: {event.actorId}</p>
        </li>)}</ul>
      </div>}
    <form ref={form} onSubmit={event => event.preventDefault()} aria-label="Xác minh ngân hàng" className="space-y-4">
      <Alert tone="notice">Chỉ xác minh sau khi kiểm tra chủ sở hữu và tên tài khoản bằng chứng cứ. Không suy xác minh từ tên hồ sơ hoặc số điện thoại.</Alert>
      {saved ? <Alert tone="success">Máy chủ đã ghi nhận xử lý. Dữ liệu hiện tại được tải lại; chưa có chuyển tiền ngân hàng.</Alert> : null}
      {message ? <Alert>{message}</Alert> : null}
      {(["reason", "evidenceNote"] as const).map(name => <Input key={name} id={`admin-bank-${name}`} name={name} label={name === "reason" ? "Lý do xử lý" : "Ghi chú chứng cứ"}
        required maxLength={500} hint="Tối đa 500 ký tự. Không nhập API key hoặc OTP." value={fields[name]} error={errors[name]} readOnly={busy || uncertain}
        autoComplete="off" className="text-base md:text-sm" onChange={event => { setFields(value => ({ ...value, [name]: event.target.value })); setErrors(value => ({ ...value, [name]: undefined })); }} />)}
      <div className="flex flex-wrap justify-end gap-3">
        {uncertain ? <Button type="button" disabled={busy} onClick={() => void review(attempt.current!.action)}>{busy ? "Đang xử lý…" : "Thử lại cùng yêu cầu"}</Button>
          : <><Button type="button" variant="secondary" disabled={busy || !mayReview} onClick={() => void review("reject")}>Từ chối tài khoản</Button>
            <Button type="button" disabled={busy || !mayReview} onClick={() => void review("verify")}>{busy ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : null}{busy ? "Đang xử lý…" : "Xác minh tài khoản"}</Button></>}
      </div>
    </form>
  </div>;
}
