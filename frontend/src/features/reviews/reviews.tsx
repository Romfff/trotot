"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LoaderCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/auth-types";
import { reviewsApi, type CreateReview, type Review } from "@/lib/api/reviews";
import { useAuthStore } from "@/stores/auth-store";

const criteria = [
  { key: "cleanliness", label: "Sạch sẽ" },
  { key: "location", label: "Vị trí" },
  { key: "value", label: "Đáng tiền" },
] as const;
type Scores = Record<(typeof criteria)[number]["key"], number>;
const emptyScores: Scores = { cleanliness: 0, location: 0, value: 0 };

export function reviewErrors(input: CreateReview): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { key } of criteria) {
    if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 5) errors[key] = "Chọn điểm từ 1 đến 5.";
  }
  if (!input.comment.trim()) errors.comment = "Viết nhận xét về trải nghiệm của bạn.";
  else if (input.comment.trim().length > 2000) errors.comment = "Nhận xét tối đa 2000 ký tự; hãy rút ngắn trước khi gửi.";
  return errors;
}

export function ReviewContent({ review }: { review: Review }) {
  return <article className="min-w-0 space-y-3">
    <header className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <p className="break-words font-medium text-ink">{review.authorName}</p>
      <time className="shrink-0 text-xs text-gray-600" dateTime={review.createdAt}>
        {new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "medium" }).format(new Date(review.createdAt))}
      </time>
    </header>
    <dl className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-5">
      {criteria.map(({ key, label }) => <div key={key} className="flex items-center gap-2">
        <dt className="text-gray-600">{label}</dt><dd className="font-medium tabular-nums text-brand">{review[key]}/5</dd>
      </div>)}
    </dl>
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{review.comment}</p>
  </article>;
}

function ReviewLoading() {
  return <div aria-busy="true" className="space-y-3 py-4">
    <span role="status" className="sr-only">Đang tải đánh giá</span>
    <div aria-hidden="true" className="space-y-3 animate-pulse motion-reduce:animate-none">
      <div className="h-4 w-1/3 rounded bg-brand-tint" /><div className="h-4 w-2/3 rounded bg-brand-tint" />
      <div className="h-16 rounded-lg bg-bg" />
    </div>
  </div>;
}

function ReviewError({ error, retry }: { error: unknown; retry: () => void }) {
  return <div role="alert" className="space-y-3 py-4">
    <p className="text-sm text-error">{error instanceof Error ? error.message : "Chưa tải được đánh giá. Vui lòng thử lại."}</p>
    <Button variant="secondary" onClick={retry}><RotateCw className="size-4" aria-hidden="true" />Thử lại</Button>
  </div>;
}

export function BookingReview({ bookingId, sessionId }: { bookingId: string; sessionId: string }) {
  const auth = useAuthStore();
  const client = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [scores, setScores] = useState<Scores>(emptyScores);
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const allowed = auth.sessionId === sessionId && auth.status === "authenticated" && auth.user?.status === "ACTIVE"
    && (auth.user.role === "TENANT" || auth.user.role === "HOST");
  const queryKey = ["booking-review", sessionId, bookingId];
  const own = useQuery({ queryKey, queryFn: ({ signal }) => reviewsApi.own(bookingId, signal), enabled: allowed && open && !busy, retry: false, refetchOnWindowFocus: true });
  const isCurrent = () => {
    const state = useAuthStore.getState();
    return mounted.current && state.sessionId === sessionId && state.status === "authenticated" && state.user?.status === "ACTIVE"
      && (state.user.role === "TENANT" || state.user.role === "HOST");
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !allowed || !isCurrent() || own.isFetching || own.error || own.data !== null) return;
    const form = event.currentTarget;
    const input = { ...scores, comment: comment.trim() };
    const invalid = reviewErrors(input);
    setErrors(invalid); setError("");
    if (Object.keys(invalid).length) { form.querySelector<HTMLElement>(`[name="${Object.keys(invalid)[0]}"]`)?.focus(); return; }
    inFlight.current = true; setBusy(true);
    try {
      const review = await reviewsApi.create(bookingId, input);
      if (!isCurrent()) return;
      await client.cancelQueries({ queryKey, exact: true });
      if (!isCurrent()) return;
      client.setQueryData(queryKey, review); setSaved(true);
      void client.invalidateQueries({ queryKey: ["property-reviews"] });
    } catch (failure) {
      if (!isCurrent()) return;
      setError(failure instanceof Error ? failure.message : "Chưa gửi được đánh giá. Vui lòng thử lại.");
      if (failure instanceof ApiError) {
        setErrors(failure.fieldErrors);
        if (failure.errorCode === "REVIEW_ALREADY_EXISTS") void own.refetch();
      }
    } finally { inFlight.current = false; if (isCurrent()) setBusy(false); }
  }
  if (!allowed) return null;
  return <section className="min-w-0 border-t border-gray-200 pt-4" aria-label="Đánh giá lưu trú">
    <Button variant="secondary" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(!open)}>
      {open ? "Thu gọn đánh giá" : "Xem / viết đánh giá"}
    </Button>
    {open ? <div id={`${id}-panel`} className="mt-4">
      {own.isPending ? <ReviewLoading /> : own.error ? <ReviewError error={own.error} retry={() => void own.refetch()} />
        : own.data ? <div className="space-y-3">
          <h3 className="text-base font-semibold">Đánh giá của bạn</h3>
          {saved ? <p role="status" className="text-sm text-brand">Đã gửi đánh giá.</p> : null}
          <ReviewContent review={own.data} />
        </div> : <form aria-label="Viết đánh giá" onSubmit={submit} noValidate className="space-y-4">
          <header><h3 className="text-base font-semibold">Đánh giá trải nghiệm</h3>
            <p className="mt-1 text-sm text-gray-600">Chọn điểm cho cả ba tiêu chí: 1 thấp nhất, 5 cao nhất. Đánh giá đã gửi không thể chỉnh sửa.</p></header>
          {error ? <p role="alert" className="text-sm text-error">{error}</p> : null}
          {criteria.map(({ key, label }) => <fieldset key={key} className="min-w-0 space-y-2" disabled={busy}>
            <legend className="text-sm font-medium">{label}</legend>
            <div className="flex gap-2">
              {/* No preselected score: the guest supplies their own opinion, not an inferred rating. */}
              {[1, 2, 3, 4, 5].map(score => <label key={score} className="relative flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-gray-200 bg-white text-base has-checked:border-brand-hover has-checked:bg-brand-tint has-checked:text-brand has-focus-visible:outline-2 has-focus-visible:outline-brand-hover has-focus-visible:outline-offset-2 has-disabled:cursor-wait">
                <input className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0" type="radio" name={key} value={score} required checked={scores[key] === score}
                  aria-label={`${label}: ${score}/5`} aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
                  onChange={() => { setScores(previous => ({ ...previous, [key]: score })); setErrors(previous => ({ ...previous, [key]: "" })); }} />
                <span aria-hidden="true" className="pointer-events-none tabular-nums">{score}</span>
              </label>)}
            </div>
            <p id={`${id}-${key}-error`} className="min-h-4 text-xs text-error">{errors[key]}</p>
          </fieldset>)}
          <div className="space-y-1.5">
            <label className="block w-fit cursor-pointer text-sm font-medium" htmlFor={`${id}-comment`}>Nhận xét</label>
            <textarea id={`${id}-comment`} name="comment" required rows={4} readOnly={busy} value={comment}
              className="field-control min-h-28 w-full resize-y text-base md:text-sm" aria-invalid={Boolean(errors.comment)} aria-describedby={`${id}-comment-hint`}
              onChange={event => { setComment(event.target.value); setErrors(previous => ({ ...previous, comment: "" })); }} />
            <p id={`${id}-comment-hint`} className={`min-h-4 text-xs ${errors.comment ? "text-error" : "text-gray-600"}`}>
              {errors.comment || (comment.length >= 1600 ? `${comment.trim().length}/2000 ký tự.` : "Tối đa 2000 ký tự. Không đưa số điện thoại hoặc thông tin riêng tư vào nhận xét.")}
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" aria-busy={busy} aria-disabled={busy || own.isFetching} onClick={event => { if (busy || own.isFetching) event.preventDefault(); }} className="relative min-w-36">
              <span className={busy ? "invisible" : ""}>Gửi đánh giá</span>
              {busy ? <LoaderCircle aria-hidden="true" className="absolute inset-0 m-auto size-4 animate-spin motion-reduce:animate-none" /> : null}
            </Button>
          </div>
        </form>}
    </div> : null}
  </section>;
}

export function PropertyReviews({ slug }: { slug: string }) {
  const [page, setPage] = useState(1);
  const reviews = useQuery({ queryKey: ["property-reviews", slug, page], meta: { public: true },
    queryFn: ({ signal }) => reviewsApi.list(slug, page, signal), retry: false, refetchOnWindowFocus: true });
  return <section className="s3-card min-w-0 space-y-4" aria-label="Đánh giá của khách">
    <h2 className="text-base font-semibold">Đánh giá của khách</h2>
    {reviews.isPending ? <ReviewLoading /> : reviews.error ? <ReviewError error={reviews.error} retry={() => void reviews.refetch()} />
      : reviews.data?.data.length ? <>
        <ul className="divide-y divide-gray-200">{reviews.data.data.map(review => <li key={review.id} className="py-4 first:pt-0"><ReviewContent review={review} /></li>)}</ul>
        <footer className="flex items-center justify-between gap-2 border-t border-gray-200 pt-4">
          <p className="text-sm text-gray-600 tabular-nums">{reviews.data.meta.total} đánh giá</p>
          {reviews.data.meta.totalPages > 1 ? <nav aria-label="Phân trang đánh giá" className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="icon" aria-label="Trang đánh giá trước" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
            <span className="text-sm tabular-nums">{reviews.data.meta.page}/{reviews.data.meta.totalPages}</span>
            <Button variant="secondary" size="icon" aria-label="Trang đánh giá sau" disabled={page >= reviews.data.meta.totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="size-4" aria-hidden="true" /></Button>
          </nav> : null}
        </footer>
      </> : <p className="py-4 text-pretty text-sm text-gray-600">Chưa có đánh giá cho chỗ ở này.</p>}
  </section>;
}
