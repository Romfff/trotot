"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Landmark, LoaderCircle, RotateCw, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiError } from "@/lib/api/client";
import { hostFinanceApi, type HostFinanceJournal } from "@/lib/api/host-finance";
import { hostPayoutsApi, type PayoutListItem } from "@/lib/api/payouts";
import { payoutNotificationsApi, type PayoutNotification } from "@/lib/api/payout-notifications";
import { decimalPriceLabel } from "@/lib/decimal-price-label";
import { useAuthStore } from "@/stores/auth-store";
import { HostRevenueChart } from './revenue-chart';
import { DebtHistory } from './debt-history';
import './stitch-finance.css';

const dateLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short",
}).format(new Date(value));
const journalLabels: Record<HostFinanceJournal["kind"], string> = {
  PAYMENT: "Ghi nhận thanh toán", REFUND: "Hoàn tiền", PAYOUT: "Chi trả", ADJUSTMENT: "Điều chỉnh",
};
const accountLabels: Record<string, string> = {
  CASH_CLEARING: "Tiền đang đối soát", HOST_PAYABLE: "Khoản phải trả chủ nhà",
  PLATFORM_COMMISSION: "Hoa hồng nền tảng", PLATFORM_SERVICE: "Phí dịch vụ nền tảng",
  TAX_PAYABLE: "Thuế phải nộp", REFUND_PAYABLE: "Khoản phải hoàn khách", HOST_DEBT: "Công nợ chủ nhà",
};

export function HostFinanceScreen() {
  const { user, status, sessionId } = useAuthStore();
  return <div className="stitch-finance-page host-finance-ledger mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold">Sổ tài chính</h1>
      {user?.role === "HOST" && <p className="finance-host-name">{user.fullName}</p>}
      <p className="mt-2 max-w-[65ch] text-sm text-gray-600 text-pretty">Theo dõi các khoản giữ và bút toán của bạn. Số liệu từ sổ máy chủ, không phải số tiền có thể rút.</p></header>
    {status === "initializing" ? <p role="status">Đang kiểm tra phiên…</p>
      : status === "unavailable" ? <Alert>Chưa kiểm tra được phiên đăng nhập. Hãy tải lại trang để thử lại.</Alert>
      : !user ? <p><Link className="text-link underline underline-offset-4" href="/login">Đăng nhập</Link> để xem sổ tài chính.</p>
      : user.role !== "HOST" || user.status !== "ACTIVE" || !sessionId ? <Alert>Trang này chỉ dành cho chủ nhà đang hoạt động.</Alert>
      : <FinanceContent key={sessionId} sessionId={sessionId} hostId={user.id} />}
  </div>;
}

function Loading({ label }: { label: string }) {
  return <div role="status" aria-label={label} aria-busy="true" className="space-y-4 py-4">
    {["w-2/3", "w-1/2", "w-3/4", "w-1/3"].map(width => <div key={width} aria-hidden="true" className={`h-5 rounded bg-gray-200 animate-pulse motion-reduce:animate-none ${width}`} />)}
    <span className="sr-only">{label}</span>
  </div>;
}

function ReadError({ title, error, retry }: { title: string; error: unknown; retry: () => void }) {
  return <div className="space-y-3 py-4">
    <Alert>{title} {apiError(error).message}</Alert>
    <Button variant="secondary" onClick={retry}><RotateCw className="size-4 shrink-0" aria-hidden="true" />Thử lại</Button>
  </div>;
}

function FinanceContent({ sessionId, hostId }: { sessionId: string; hostId: string }) {
  const [page, setPage] = useState(1);
  const summary = useQuery({ queryKey: ["host-finance", sessionId], queryFn: ({ signal }) => hostFinanceApi.summary(signal),
    retry: false, gcTime: 0, refetchOnWindowFocus: true });
  const history = useQuery({ queryKey: ["host-finance-transactions", sessionId, page],
    queryFn: ({ signal }) => hostFinanceApi.transactions(page, signal), placeholderData: keepPreviousData,
    retry: false, gcTime: 0, refetchOnWindowFocus: true });
  const balances = summary.data && [
    ["Chờ hoàn thành hoặc xử lý", summary.data.balances.waitingCompletion],
    ["Đang trong thời gian giữ", summary.data.balances.pendingHold],
    ["Đủ thời gian giữ, trước bù trừ", summary.data.balances.eligibleBeforeDeductions],
    ["Đang đóng băng do khiếu nại", summary.data.balances.frozen],
  ];
  return <>
    <aside className="finance-principle" aria-label="Nguyên tắc chi trả">
      <ShieldCheck aria-hidden="true" className="size-5 shrink-0" />
      <div><p className="font-semibold">Theo dõi rõ từng khoản trong sổ</p>
        <p className="mt-1 text-sm text-pretty">Mốc đối soát: Thứ Hai, 09:00 giờ Việt Nam. Đủ thời gian giữ không có nghĩa là đã chuyển tiền; Admin kiểm tra đối soát, công nợ, khiếu nại và ngân hàng trước khi chi trả.</p></div>
    </aside>
    <section aria-labelledby="finance-summary-title" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <h2 id="finance-summary-title" className="flex min-h-11 items-center text-base font-semibold">Các khoản trong sổ</h2>
        <Button variant="secondary" aria-disabled={summary.isFetching} onClick={() => { if (!summary.isFetching) void summary.refetch(); }}>
          <RotateCw className="size-4 shrink-0" aria-hidden="true" />Tải lại</Button>
      </header>
      {summary.isError ? <ReadError title="Chưa tải được số liệu." error={summary.error} retry={() => void summary.refetch()} />
        : !summary.data ? <Loading label="Đang tải số liệu tài chính" />
        : <div className="space-y-4" aria-busy={summary.isFetching}>
          {summary.isFetching ? <p role="status" className="text-xs text-gray-600">Đang cập nhật số liệu…</p> : null}
          <dl className="stitch-finance-balances grid grid-cols-1 gap-4 sm:grid-cols-2">
            {balances?.map(([label, amount]) => <div key={label} className="min-w-0 space-y-1">
              <dt className="text-sm text-gray-600">{label}</dt>
              <dd className={`text-lg font-semibold tabular-nums wrap-anywhere ${amount.length > 12 ? "finance-long-amount" : ""}`}>{decimalPriceLabel(amount)}đ</dd>
            </div>)}
          </dl>
          <p className="text-xs text-gray-600">Cập nhật lúc {dateLabel(summary.data.serverTime)} (giờ Việt Nam).</p>
          {summary.data.reviewCount > 0 ? <Alert tone="notice">Có {summary.data.reviewCount} đơn cần kiểm tra chứng cứ tài chính; chưa cộng vào các khoản trên.</Alert> : null}
        </div>}
    </section>
    <div className="finance-observation-grid">
      <section className="finance-bank-overview" aria-labelledby="finance-bank-title">
        <div className="finance-panel-icon"><Landmark className="size-5" aria-hidden="true" /></div>
        <h2 id="finance-bank-title" className="font-semibold">Ngân hàng nhận tiền</h2>
        <p className="text-sm text-gray-600">Trạng thái xác minh từ máy chủ.</p>
        {summary.isError ? <p className="text-sm text-gray-600">Chưa tải được trạng thái ngân hàng. Tải lại số liệu để kiểm tra.</p>
          : !summary.data ? <p role="status" className="text-sm text-gray-600">Đang tải trạng thái ngân hàng…</p>
          : <p className="finance-bank-status">Ngân hàng: <span className="font-medium">{summary.data.bankVerified ? "Đã xác minh" : "Chưa được xác minh"}</span></p>}
        <p className="text-sm text-gray-600 text-pretty">Tài khoản đã khai báo cần được xác minh trước khi chi trả. Thông tin và kết quả xét duyệt nằm trong trang quản lý ngân hàng.</p>
        <Link href="/host/bank-account" className="button button-secondary">Quản lý ngân hàng nhận tiền</Link>
      </section>
      <HostRevenueChart sessionId={sessionId} />
    </div>
    <div className="finance-debt-overview"><DebtHistory sessionId={sessionId} /></div>
    <PayoutHistory sessionId={sessionId} hostId={hostId} />
    <PayoutNotifications sessionId={sessionId} />
    <section aria-labelledby="finance-history-title" className="relative rounded-xl border border-gray-200 bg-white">
      <header className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0"><h2 id="finance-history-title" className="text-base font-semibold">Lịch sử bút toán</h2>
          <p className="mt-1 text-sm text-gray-600 text-pretty">Bút toán Nợ/Có là dòng ghi sổ, không phải tổng thu nhập hoặc chứng nhận đã nhận tiền.</p></div>
      </header>
      {history.isFetching && history.data ? <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-brand animate-pulse motion-reduce:animate-none" /> : null}
      <div className="px-4 sm:px-5">
        {history.isError ? <ReadError title={`Chưa tải được trang ${page}.`} error={history.error} retry={() => void history.refetch()} />
          : !history.data ? <Loading label="Đang tải lịch sử bút toán" />
          : <div aria-busy={history.isFetching}>
            {history.isFetching ? <p role="status" className="pb-3 text-xs text-gray-600">Đang tải lịch sử…</p> : null}
            {history.data.data.length === 0 ? <p className="py-6 text-sm text-gray-600">Chưa có bút toán ở trang này.</p>
              : <ul className="divide-y divide-gray-200">{history.data.data.map(row => <JournalRow key={row.id} row={row} />)}</ul>}
          </div>}
      </div>
      {history.data && !history.isError && history.data.meta.total > 0 ? <footer className="flex items-center justify-between gap-3 border-t border-gray-200 p-4 sm:px-5">
        <p className="text-sm text-gray-600 tabular-nums">{history.data.meta.total.toLocaleString("vi-VN")} bút toán</p>
        {history.data.meta.totalPages > 1 ? <nav aria-label="Phân trang bút toán" className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Trang trước" disabled={history.isFetching || history.data.meta.page <= 1}
            onClick={() => setPage(history.data!.meta.page - 1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
          <span className="text-sm tabular-nums" aria-current="page">{history.data.meta.page} / {history.data.meta.totalPages}</span>
          <Button variant="secondary" size="icon" aria-label="Trang sau" disabled={history.isFetching || history.data.meta.page >= history.data.meta.totalPages}
            onClick={() => setPage(history.data!.meta.page + 1)}><ChevronRight className="size-4" aria-hidden="true" /></Button>
        </nav> : null}
      </footer> : null}
    </section>
  </>;
}

const noticeLabels: Record<PayoutNotification["type"], string> = {
  CREATED: "Lô chi trả mới", APPROVED: "Lô đã được duyệt", CANCELLED: "Lô đã bị hủy", PAID: "Ghi nhận chi trả thủ công",
};
function PayoutNotifications({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const cache = useQueryClient();
  const queryKey = ["host-payout-notifications", sessionId];
  const list = useQuery({ queryKey: [...queryKey, page],
    queryFn: ({ signal }) => payoutNotificationsApi.list(page, signal), retry: false, gcTime: 0, refetchOnWindowFocus: true });
  const isCurrent = () => {
    const state = useAuthStore.getState();
    return state.sessionId === sessionId && state.status === "authenticated" && state.user?.role === "HOST" && state.user.status === "ACTIVE";
  };
  async function read(id: string) {
    if (inFlight.current || !isCurrent()) return;
    inFlight.current = true; setBusyId(id); setMessage("");
    try {
      await payoutNotificationsApi.markRead(id);
      if (!isCurrent()) return;
      await cache.invalidateQueries({ queryKey });
    } catch (failure) {
      if (isCurrent()) setMessage(`Chưa xác nhận được dấu đã đọc. ${apiError(failure).message}`);
    } finally {
      inFlight.current = false;
      if (isCurrent()) setBusyId(null);
    }
  }
  return <section aria-labelledby="payout-notifications-title" className="relative rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <header className="mb-4 flex items-center justify-between gap-3">
      <div className="min-w-0"><h2 id="payout-notifications-title" className="text-base font-semibold">Thông báo chi trả</h2>
        <p className="mt-1 text-sm text-gray-600 tabular-nums">{list.data ? `${list.data.meta.unreadCount.toLocaleString("vi-VN")} chưa đọc` : "Cập nhật từ lịch sử xử lý lô chi trả."}</p></div>
      <Button variant="secondary" aria-label="Tải lại thông báo chi trả" aria-disabled={list.isFetching || !!busyId}
        onClick={() => { if (!list.isFetching && !busyId) void list.refetch(); }}><RotateCw className="size-4 shrink-0" aria-hidden="true" />Tải lại</Button>
    </header>
    {message ? <Alert className="mb-4">{message} Bạn có thể bấm đánh dấu lại cùng thông báo.</Alert> : null}
    {list.isFetching && list.data ? <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-brand animate-pulse motion-reduce:animate-none" /> : null}
    {list.isError && !list.data ? <ReadError title="Chưa tải được thông báo." error={list.error} retry={() => void list.refetch()} />
      : !list.data ? <Loading label="Đang tải thông báo chi trả" />
      : <div aria-busy={list.isFetching}>
        {list.isError ? <ReadError title="Chưa cập nhật được thông báo; đang hiển thị lần tải trước." error={list.error} retry={() => void list.refetch()} /> : null}
        {list.data.data.length === 0 ? <p className="py-6 text-sm text-gray-600">Chưa có thông báo chi trả ở trang này.</p>
          : <ul className="divide-y divide-gray-200">{list.data.data.map(row => <li key={row.id} className="space-y-3 py-4">
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
              <div className="min-w-0 space-y-1">
                <h3 className={`text-sm ${row.readAt ? "text-gray-600" : "font-medium"}`}>{noticeLabels[row.type]}</h3>
                <p className="max-w-[75ch] text-sm text-gray-600 text-pretty wrap-anywhere">{row.message}</p>
                <p className="text-xs text-gray-600"><time dateTime={row.createdAt}>{dateLabel(row.createdAt)}</time> · {row.readAt ? "Đã đọc" : "Chưa đọc"}</p>
              </div>
              <Button variant="secondary" className="min-w-48 shrink-0" aria-label={`${row.readAt ? "Đã đọc" : "Đánh dấu đã đọc"}: ${noticeLabels[row.type]}`}
                aria-disabled={!!busyId || !!row.readAt} aria-busy={busyId === row.id} onClick={() => { if (!row.readAt) void read(row.id); }}>
                {busyId === row.id ? <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="size-4 shrink-0" aria-hidden="true" />}
                {row.readAt ? "Đã đọc" : "Đánh dấu đã đọc"}</Button>
            </div>
          </li>)}</ul>}
        {list.data.meta.totalPages > 1 ? <nav aria-label="Phân trang thông báo chi trả" className="mt-4 flex items-center justify-end gap-2">
          <Button variant="secondary" size="icon" aria-label="Thông báo trang trước" disabled={list.isFetching || !!busyId || page <= 1}
            onClick={() => { setMessage(""); setPage(page - 1); }}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
          <span className="text-sm tabular-nums" aria-current="page">{page} / {list.data.meta.totalPages}</span>
          <Button variant="secondary" size="icon" aria-label="Thông báo trang sau" disabled={list.isFetching || !!busyId || page >= list.data.meta.totalPages}
            onClick={() => { setMessage(""); setPage(page + 1); }}><ChevronRight className="size-4" aria-hidden="true" /></Button>
        </nav> : null}
      </div>}
  </section>;
}

const payoutLabels: Record<PayoutListItem["status"], string> = {
  DRAFT: "Lô nháp", APPROVED: "Đã duyệt · chưa xác nhận chi trả", CANCELLED: "Lô đã hủy", PAID: "Admin đã xác nhận chi trả",
};
function PayoutHistory({ sessionId, hostId }: { sessionId: string; hostId: string }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["host-payouts", sessionId, page],
    queryFn: ({ signal }) => hostPayoutsApi.list(page, signal, hostId), retry: false, gcTime: 0, refetchOnWindowFocus: true });
  return <section aria-labelledby="host-payout-title" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <h2 id="host-payout-title" className="text-base font-semibold">Lịch sử lô chi trả</h2>
    <p className="mt-1 text-sm text-gray-600">Admin chi trả thủ công. Đã duyệt không có nghĩa là đã chuyển tiền.</p>
    {list.isError ? <ReadError title="Chưa tải được lô chi trả." error={list.error} retry={() => void list.refetch()} />
      : !list.data ? <Loading label="Đang tải lô chi trả" />
      : <div aria-busy={list.isFetching}>
        {list.data.data.length === 0 ? <p className="py-6 text-sm text-gray-600">Chưa có lô chi trả ở trang này.</p>
          : <ul className="mt-4 divide-y divide-gray-200">{list.data.data.map(row => <li key={row.id} className="space-y-3 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1"><p className="text-lg font-semibold tabular-nums wrap-anywhere">{decimalPriceLabel(row.amount)}đ</p>
                <p className={`text-sm font-medium ${row.status === "PAID" ? "text-brand" : "text-gray-600"}`}>{payoutLabels[row.status]}</p>
                <p className="text-xs text-gray-600">{row.bankCode} · {row.accountNumber} · {dateLabel(row.createdAt)}</p>
              </div>
              <Button variant="secondary" aria-expanded={selected === row.id} aria-controls={`payout-${row.id}`}
                onClick={() => setSelected(selected === row.id ? null : row.id)}>{selected === row.id ? "Đóng chi tiết" : "Xem chi tiết"}</Button>
            </div>
            <p className="text-xs font-mono text-gray-600 wrap-anywhere">{row.id}</p>
            <div id={`payout-${row.id}`} hidden={selected !== row.id}>
              {selected === row.id ? <PayoutDetail id={row.id} sessionId={sessionId} hostId={hostId} /> : null}
            </div>
          </li>)}</ul>}
        {list.data.meta.totalPages > 1 ? <nav aria-label="Phân trang lô chi trả" className="mt-4 flex items-center justify-end gap-2">
          <Button variant="secondary" size="icon" aria-label="Lô chi trả trang trước" disabled={list.isFetching || page <= 1}
            onClick={() => { setSelected(null); setPage(page - 1); }}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
          <span className="text-sm tabular-nums" aria-current="page">{page} / {list.data.meta.totalPages}</span>
          <Button variant="secondary" size="icon" aria-label="Lô chi trả trang sau" disabled={list.isFetching || page >= list.data.meta.totalPages}
            onClick={() => { setSelected(null); setPage(page + 1); }}><ChevronRight className="size-4" aria-hidden="true" /></Button>
        </nav> : null}
      </div>}
  </section>;
}
function PayoutDetail({ id, sessionId, hostId }: { id: string; sessionId: string; hostId: string }) {
  const detail = useQuery({ queryKey: ["host-payout-detail", sessionId, id],
    queryFn: ({ signal }) => hostPayoutsApi.detail(id, signal, hostId), retry: false, gcTime: 0, refetchOnWindowFocus: true });
  if (detail.isError) return <ReadError title="Chưa tải được chi tiết." error={detail.error} retry={() => void detail.refetch()} />;
  if (!detail.data) return <Loading label="Đang tải chi tiết lô chi trả" />;
  const row = detail.data;
  return <div className="space-y-4 border-l-2 border-gray-200 pl-4 text-sm" aria-busy={detail.isFetching}>
    <p className="font-medium">{payoutLabels[row.status]}</p>
    <p className="text-gray-600">Mốc đối soát: {dateLabel(row.cutoff)} (giờ Việt Nam).</p>
    {row.confirmation ? <p className="text-brand">Admin xác nhận lúc {dateLabel(row.confirmation.confirmedAt)}. Đây là ghi nhận chi trả thủ công, không phải xác minh tự động của ngân hàng.</p>
      : <p className="text-gray-600">Lô này chưa có xác nhận đã chi trả.</p>}
    <h3 className="font-medium">Các đơn trong lô</h3>
    <ul className="space-y-3">{row.items.map(item => <li key={item.bookingId} className="space-y-1">
      <p className="font-mono text-xs wrap-anywhere">{item.bookingId}</p>
      <p className="font-medium tabular-nums">{decimalPriceLabel(item.amount)}đ</p>
      <p className="text-xs text-gray-600">Đủ thời gian giữ: {dateLabel(item.eligibleAt)} · {item.status === "RELEASED" ? "Đã nhả khỏi lô" : "Thuộc lô này"}</p>
    </li>)}</ul>
    <h3 className="font-medium">Lịch sử xử lý</h3>
    <ul className="space-y-2 text-gray-600">{row.events.map((event, index) => <li key={index}>{({ CREATED: "Tạo lô", APPROVED: "Duyệt lô", CANCELLED: "Hủy lô", PAID: "Xác nhận chi trả" })[event.action]} · {dateLabel(event.createdAt)}</li>)}</ul>
  </div>;
}

function JournalRow({ row }: { row: HostFinanceJournal }) {
  return <li className="space-y-3 py-4">
    <div><h3 className="text-sm font-medium">{journalLabels[row.kind]}</h3>
      <time className="text-xs text-gray-600" dateTime={row.createdAt}>{dateLabel(row.createdAt)}</time></div>
    <dl className="space-y-1 text-xs text-gray-600">
      <div className="flex flex-wrap gap-x-2"><dt>Bút toán</dt><dd className="min-w-0 font-mono wrap-anywhere">{row.id}</dd></div>
      {row.bookingId ? <div className="flex flex-wrap gap-x-2"><dt>ID đơn</dt><dd className="min-w-0 font-mono wrap-anywhere">{row.bookingId}</dd></div> : null}
    </dl>
    <dl className="space-y-3 text-sm">{row.entries.map((entry, index) => <div key={index} className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
      <dt className="text-gray-600">{accountLabels[entry.account]} <span className="font-medium">({entry.side === "DEBIT" ? "Nợ" : "Có"})</span></dt>
      <dd className="font-medium tabular-nums wrap-anywhere sm:text-right">{decimalPriceLabel(entry.amount)}đ</dd>
    </div>)}</dl>
  </li>;
}
