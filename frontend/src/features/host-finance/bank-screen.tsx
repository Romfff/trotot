"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, RotateCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiError } from "@/lib/api/client";
import { hostFinanceApi, type SubmitBank } from "@/lib/api/host-finance";
import { useAuthStore } from "@/stores/auth-store";
import { bankFieldErrors, bankNeedsReplay, type BankFields } from "./bank-form";
import './stitch-finance.css';

export function HostBankScreen() {
  const { user, status, sessionId } = useAuthStore();
  return <div className="stitch-finance-page stitch-bank-page mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold">Ngân hàng nhận tiền</h1>
      <p className="mt-2 text-sm text-gray-600 text-pretty">Thông tin nhận tiền của chủ nhà, được Admin xác minh trước khi chi trả.</p></header>
    {status === "initializing" ? <p role="status">Đang kiểm tra phiên…</p>
      : status === "unavailable" ? <Alert>Chưa kiểm tra được phiên đăng nhập. Hãy tải lại trang để thử lại.</Alert>
      : !user ? <p><Link className="text-link underline underline-offset-4" href="/login">Đăng nhập</Link> để quản lý ngân hàng nhận tiền.</p>
      : user.role !== "HOST" || user.status !== "ACTIVE" || !sessionId ? <Alert>Trang này chỉ dành cho chủ nhà đang hoạt động.</Alert>
      : <BankForm key={sessionId} sessionId={sessionId} />}
  </div>;
}

function BankForm({ sessionId }: { sessionId: string }) {
  const client = useQueryClient();
  const queryKey = ["host-bank", sessionId];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => hostFinanceApi.bank(signal), retry: false, gcTime: 0 });
  const [fields, setFields] = useState<BankFields>({ bankCode: "", accountNumber: "", accountName: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof BankFields, string>>>({});
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const attempt = useRef<{ key: string; body: SubmitBank } | null>(null);
  const inFlight = useRef(false);
  const isCurrent = () => {
    const state = useAuthStore.getState();
    return state.sessionId === sessionId && state.status === "authenticated" && state.user?.role === "HOST" && state.user.status === "ACTIVE";
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !isCurrent() || !query.data || query.isError || query.isFetching) return;
    if (!attempt.current) {
      const invalid = bankFieldErrors(fields); setErrors(invalid);
      const first = Object.keys(invalid)[0];
      if (first) { event.currentTarget.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus(); return; }
      attempt.current = { key: crypto.randomUUID(), body: { ...fields, expectedVersion: query.data.version } };
    }
    inFlight.current = true; setBusy(true); setMessage(""); setSaved(false);
    const sent = attempt.current;
    try {
      await hostFinanceApi.submitBank(sent.body, sent.key);
      if (!isCurrent()) return;
      // An idempotent replay may contain an older PENDING snapshot. Re-read the
      // current bank rather than overwriting a newer Admin review with it.
      attempt.current = null; setUncertain(false); setSaved(true);
      setFields({ bankCode: "", accountNumber: "", accountName: "" });
      await client.invalidateQueries({ queryKey });
      void client.invalidateQueries({ queryKey: ["host-finance", sessionId] });
      void client.invalidateQueries({ queryKey: ["host-bank-notifications", sessionId] });
    } catch (failure) {
      if (!isCurrent()) return;
      const error = apiError(failure), replay = bankNeedsReplay(error);
      setUncertain(replay);
      setMessage(replay ? "Chưa xác nhận được kết quả lưu. Giữ nguyên thông tin và bấm thử lại; không gửi tài khoản khác lúc này." : error.message);
      setErrors(error.fieldErrors);
      if (!replay) attempt.current = null;
      if (error.errorCode === "STALE_BANK_VERSION") void query.refetch();
    } finally {
      inFlight.current = false;
      if (isCurrent()) setBusy(false);
    }
  }
  if (query.isPending) return <div role="status" aria-label="Đang tải ngân hàng" className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
    <span className="sr-only">Đang tải ngân hàng</span>
    {[1, 2, 3].map(key => <div key={key} aria-hidden="true" className="h-11 rounded-lg bg-background motion-safe:animate-pulse" />)}
  </div>;
  const account = query.data?.account;
  return <>
    {query.isError ? <div role="alert" className="space-y-3"><p className="field-error">Chưa tải được thông tin ngân hàng. {apiError(query.error).message}</p>
      <Button variant="secondary" onClick={() => void query.refetch()}><RotateCw size={16} aria-hidden="true" />Thử lại tải thông tin</Button></div> : null}
    {query.data ? <section aria-labelledby="bank-current-title" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
      <h2 id="bank-current-title" className="text-base font-semibold">Tài khoản hiện tại</h2>
      {account ? <dl className="mt-4 space-y-3 text-sm">
        {[["Ngân hàng", account.bankCode], ["Số tài khoản", account.accountNumber], ["Chủ tài khoản", account.accountName]].map(([label, value]) => <div key={label} className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-gray-600">{label}</dt><dd className="min-w-0 wrap-anywhere font-medium">{value}</dd></div>)}
        <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4"><dt className="text-gray-600">Trạng thái</dt><dd><span className="status-pill">{account.status === "VERIFIED" ? "Đã xác minh" : account.status === "REJECTED" ? "Chưa được chấp nhận" : "Chờ Admin xác minh"}</span></dd></div>
      </dl> : <p className="mt-4 text-sm text-gray-600">Chưa có tài khoản nhận tiền. Điền thông tin bên dưới để gửi xác minh.</p>}
      {account?.status === "VERIFIED" ? <p className="mt-4 text-sm text-gray-600 text-pretty">Đã xác minh ngân hàng không đồng nghĩa các khoản tiền đã đủ điều kiện chi trả.</p> : null}
      {query.isFetching ? <p role="status" className="mt-3 text-sm text-gray-600">Đang cập nhật thông tin…</p> : null}
    </section> : null}
    <form onSubmit={submit} noValidate className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-label="Gửi ngân hàng nhận tiền">
      <h2 className="text-base font-semibold">{account ? "Gửi tài khoản thay thế" : "Thêm tài khoản nhận tiền"}</h2>
      <Alert tone="notice" className="text-pretty">Gửi tài khoản mới sẽ chặn các khoản chưa chi trả cho đến khi Admin xác minh. Hệ thống không trả vào tài khoản cũ trong thời gian này.</Alert>
      {saved ? <Alert tone="success">Đã gửi thông tin để Admin xác minh. Chưa có chuyển tiền ngân hàng.</Alert> : null}
      {message ? <Alert>{message}</Alert> : null}
      {(Object.keys(fields) as (keyof BankFields)[]).map(name => <Input key={name} name={name} id={`host-bank-${name}`} required
        label={name === "bankCode" ? "Mã ngân hàng" : name === "accountNumber" ? "Số tài khoản" : "Tên chủ tài khoản"}
        hint={name === "bankCode" ? "Mã viết tắt do ngân hàng cung cấp; tối đa 20 ký tự." : name === "accountNumber" ? "Giữ nguyên các số 0 ở đầu; tối đa 50 ký tự." : "Ghi đúng tên đăng ký với ngân hàng; tối đa 150 ký tự."}
        value={fields[name]} error={errors[name]} readOnly={busy || uncertain} autoComplete="off" spellCheck={false} className="text-base md:text-sm"
        onChange={event => { setFields(current => ({ ...current, [name]: event.target.value })); setErrors(current => ({ ...current, [name]: undefined })); }} />)}
      <div className="flex justify-end"><Button type="submit" aria-busy={busy} aria-disabled={busy || !query.data || query.isError || query.isFetching}
        className="w-full sm:w-auto" onClick={event => { if (busy || !query.data || query.isError || query.isFetching) event.preventDefault(); }}>
        {busy ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : null}{busy ? "Đang gửi…" : uncertain ? "Thử lại cùng thông tin" : "Gửi Admin xác minh"}
      </Button></div>
    </form>
  </>;
}
