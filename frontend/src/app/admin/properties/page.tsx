"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { managementRequest, apiError } from "@/lib/api/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AdminListingPhotos } from "@/features/admin/listing-photos";

type Content = Record<string, string | number | boolean | string[] | null>;
type Listing = {
  id: string; title: string; description: string; status: string; version: number;
  addressDetail: string; provinceCode: string; wardCode: string; propertyType: string;
  isAvailable: boolean; longTermDetail: Content | null; videoUrl: string | null;
  images: { url: string }[]; amenities: { amenityId: string }[];
  revision: { status: string; content: Content } | null;
};
type Queue = { data: Listing[]; meta: { total: number; totalPages: number } };
const labels = [
  ["title", "Tiêu đề"], ["description", "Mô tả"], ["propertyType", "Loại nhà"],
  ["addressDetail", "Địa chỉ"], ["provinceCode", "Mã tỉnh/thành"], ["wardCode", "Mã phường/xã"],
  ["monthlyPrice", "Giá thuê/tháng (VND)"], ["depositAmount", "Tiền cọc (VND)"], ["areaSqm", "Diện tích (m²)"],
  ["leaseTermMonths", "Thời hạn thuê (tháng)"], ["contactPhone", "Số liên hệ"], ["contactZalo", "Zalo liên hệ"],
  ["amenityIds", "Tiện ích"], ["imageUrls", "Ảnh"], ["videoUrl", "Video"],
  ["electricityCost", "Giá điện"], ["waterCost", "Giá nước"], ["waterUnit", "Đơn vị nước"],
  ["internetCost", "Internet"], ["garbageCost", "Vệ sinh"], ["parkingFee", "Gửi xe"], ["allowPets", "Cho phép thú cưng"],
] as const;

const statusLabels: Record<string, string> = { PENDING_REVIEW: "Chờ duyệt", PUBLISHED: "Đang hiển thị", HIDDEN: "Tạm ẩn", REJECTED: "Đã từ chối", DRAFT: "Bản nháp", EXPIRED: "Hết hạn" };

function Preview({ heading, content }: { heading: string; content: Content }) {
  return <section className="min-w-0 rounded-lg border border-gray-200 p-4">
    <h3 className="mb-3 font-semibold text-ink">{heading}</h3>
    <AdminListingPhotos title={heading} imageUrls={content.imageUrls} />
    <dl className="space-y-3 text-sm">{labels.map(([field, label]) => <div key={field}>
      <dt className="text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-ink">{typeof content[field] === "boolean" ? (content[field] ? "Có" : "Không") : Array.isArray(content[field]) ? (content[field] as string[]).join(", ") || "—" : content[field] ?? "—"}</dd>
    </div>)}</dl>
  </section>;
}

function ReviewDetail({ id, sessionId, onReviewed, onDenied }: { id: string; sessionId: string; onReviewed: (id: string, message: string) => void; onDenied: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [stale, setStale] = useState(false);
  const detail = useQuery({ queryKey: ["admin-listing-detail", sessionId, id],
    queryFn: () => managementRequest<{ data: Listing }>(`/admin/properties/${id}`), retry: false, staleTime: 0 });
  const listing = detail.data?.data;
  const mutation = useMutation({ mutationFn: async (action: "approve" | "reject") => {
    if (!listing || stale || detail.isFetching || detail.isError) throw new Error("Read listing first");
    const ack = await managementRequest<{ data: { id: string; status: string; version: number } }>(`/admin/properties/${id}/${action}`,
      { method: "POST", data: { expectedVersion: listing.version } });
    if (ack.data.id !== id || ack.data.version !== listing.version + 1) throw new Error("Invalid review acknowledgment");
    return action;
  }, onSuccess: action => onReviewed(id, action === "approve" ? "Đã duyệt nội dung." : "Đã từ chối nội dung."),
    onError: error => { if (apiError(error).status === 409) setStale(true); }, retry: false });
  useEffect(() => { if (listing) heading.current?.focus(); }, [listing]);
  const denied = [detail.error, mutation.error].some(error => error && apiError(error).status === 403);
  useEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  if (denied) return <Alert>Bạn không có quyền duyệt tin này.</Alert>;
  const pendingRevision = listing?.revision?.status === "PENDING_REVIEW" && ["PUBLISHED", "HIDDEN"].includes(listing.status);
  const canReview = listing && (listing.status === "PENDING_REVIEW" || pendingRevision);
  return <section aria-label="Nội dung duyệt tin" className="min-w-0 space-y-4">
    {detail.isPending && <p role="status">Đang tải nội dung…</p>}
    {detail.isError && <Alert>{apiError(detail.error).message}</Alert>}
    {mutation.isError && <Alert>{apiError(mutation.error).message}</Alert>}
    {stale && <Alert tone="notice">Tin đã thay đổi. Tải lại và xem nội dung mới trước khi duyệt.</Alert>}
    <Button variant="secondary" disabled={detail.isFetching || mutation.isPending} onClick={async () => {
      const result = await detail.refetch();
      if (!result.isError) { setStale(false); mutation.reset(); }
    }}>Tải lại nội dung</Button>
    {listing && <>
      <h2 ref={heading} tabIndex={-1} className="break-words text-xl font-semibold text-ink">{listing.title}</h2>
      <p className="text-sm text-muted">Phiên bản {listing.version} · {statusLabels[listing.status] || "Chưa xác định"} · {listing.isAvailable ? "Còn phòng" : "Hết phòng"}</p>
      <Link href={`/admin/properties/${listing.id}/nearby`} className="inline-flex min-h-11 items-center text-brand underline">Quản lý địa điểm xung quanh</Link>
      {pendingRevision && <Alert tone="notice">Đang duyệt bản sửa. Bản đã duyệt vẫn giữ trạng thái hiển thị do Chủ nhà chọn.</Alert>}
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <Preview heading={pendingRevision ? "Bản đã duyệt" : "Nội dung tin"}
          content={{ ...listing.longTermDetail, title: listing.title, description: listing.description,
            propertyType: listing.propertyType, addressDetail: listing.addressDetail, provinceCode: listing.provinceCode, wardCode: listing.wardCode, videoUrl: listing.videoUrl,
            imageUrls: listing.images.map(image => image.url), amenityIds: listing.amenities.map(amenity => amenity.amenityId) }} />
        {pendingRevision && <Preview heading="Bản sửa chờ duyệt" content={listing.revision!.content} />}
      </div>
      {!canReview && <Alert tone="notice">Tin không còn nội dung chờ duyệt.</Alert>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={!canReview || stale || detail.isFetching || detail.isError || mutation.isPending} onClick={() => mutation.mutate("approve")}>
          {mutation.isPending && mutation.variables === "approve" ? "Đang duyệt…" : "Duyệt nội dung"}
        </Button>
        <Button variant="secondary" disabled={!canReview || stale || detail.isFetching || detail.isError || mutation.isPending} onClick={() => mutation.mutate("reject")}>
          {mutation.isPending && mutation.variables === "reject" ? "Đang từ chối…" : "Từ chối nội dung"}
        </Button>
      </div>
    </>}
  </section>;
}

function QueueContent({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [denied, setDenied] = useState(false);
  const queue = useQuery({ queryKey: ["admin-listing-queue", sessionId, page],
    queryFn: () => managementRequest<Queue>("/admin/properties", { params: { page, limit: 10 } }), retry: false });
  if (denied || (queue.isError && apiError(queue.error).status === 403)) return <Alert>Bạn không có quyền truy cập hàng chờ.</Alert>;
  return <>
    {message && <Alert tone="success">{message}</Alert>}
    {queue.isPending && <p role="status">Đang tải hàng chờ…</p>}
    {queue.isError && <Alert>{apiError(queue.error).message}</Alert>}
    <Button variant="secondary" disabled={queue.isFetching} onClick={() => { void queue.refetch(); }}>Tải lại hàng chờ</Button>
    <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <aside aria-label="Hàng chờ duyệt" className="min-w-0 space-y-3">
        {queue.data?.data.length === 0 && <p>Không có tin đang chờ duyệt.</p>}
        {queue.data?.data.map(listing => <button key={listing.id} type="button" aria-pressed={selected === listing.id}
          className={`w-full rounded-lg border p-4 text-left ${selected === listing.id ? "border-primary bg-soft-green" : "border-gray-200 bg-white"}`}
          onClick={() => { setSelected(listing.id); setMessage(""); }}>
          <span className="block break-words font-semibold text-ink">{listing.title}</span>
          <span className="mt-2 block text-sm text-muted">{listing.revision?.status === "PENDING_REVIEW" ? "Bản sửa chờ duyệt" : "Tin mới chờ duyệt"} · phiên bản {listing.version}</span>
        </button>)}
        <nav aria-label="Phân trang hàng chờ" className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1 || queue.isFetching} onClick={() => { setSelected(null); setPage(page - 1); }}>Trước</Button>
          <span className="text-sm">Trang {page}/{Math.max(1, queue.data?.meta.totalPages ?? 1)}</span>
          <Button variant="secondary" size="sm" disabled={!queue.data || page >= queue.data.meta.totalPages || queue.isFetching} onClick={() => { setSelected(null); setPage(page + 1); }}>Sau</Button>
        </nav>
      </aside>
      {selected ? <ReviewDetail key={selected} id={selected} sessionId={sessionId} onDenied={() => setDenied(true)} onReviewed={(reviewedId, text) => {
        setMessage(text); setSelected(current => current === reviewedId ? null : current);
        queryClient.setQueryData<Queue>(["admin-listing-queue", sessionId, page], old => old && ({ ...old, data: old.data.filter(item => item.id !== reviewedId) }));
        void queryClient.invalidateQueries({ queryKey: ["admin-listing-queue", sessionId] });
      }} /> : <p className="text-muted">Chọn một tin để xem nội dung và phiên bản trước khi duyệt.</p>}
    </div>
  </>;
}

export default function AdminPropertiesPage() {
  const user = useAuthStore(state => state.user);
  const status = useAuthStore(state => state.status);
  const sessionId = useAuthStore(state => state.sessionId);
  return <section aria-label="Quản trị tin" className="mx-auto min-w-0 max-w-6xl px-4 py-8">
    <h1 className="mb-2 text-2xl font-bold text-ink">Duyệt tin trọ dài hạn</h1>
    <p className="mb-6 text-sm text-muted">Xem nội dung tin mới và bản sửa đang chờ duyệt.</p>
    {status === "initializing" ? <p role="status">Đang kiểm tra phiên đăng nhập…</p>
      : status === "unavailable" ? <><Alert>Chưa thể kiểm tra phiên đăng nhập.</Alert><Button onClick={() => window.dispatchEvent(new Event("trotot:retry-session"))}>Thử lại</Button></>
      : !user ? <Link className="button" href="/login">Đăng nhập</Link>
      : user.role !== "ADMIN" || user.status !== "ACTIVE" ? <Alert>Tài khoản này không có quyền duyệt tin.</Alert>
      : sessionId && <QueueContent key={`${sessionId}:${user.id}:${user.role}:${user.status}`} sessionId={sessionId} />}
  </section>;
}
