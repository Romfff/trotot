"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { Camera, ImageOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListingGallery } from "@/components/listing/listing-gallery";
import { ListingTypeNavigation } from "@/components/listing/listing-type-navigation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HostGate } from "@/features/host-listings/screens";
import { AddressCombobox } from "@/features/host-listings/address-combobox";
import { ListingLocationPicker } from "@/features/host-listings/location-picker";
import { AdminAccess, AdminNavigation } from "@/features/admin/admin-screens";
import { useAuthStore } from "@/stores/auth-store";
import { apiError } from "@/lib/api/client";
import { addressCatalog, listingStatuses } from "@/lib/api/host-listings";
import { listingsApi } from "@/lib/api/listings";
import { homestayContent, homestayFormContent, homestayUnitInput, hostHomestaysApi, unitTime, type OwnHomestay, type OwnUnit, type UnitInput } from "@/lib/api/host-homestays";
import { isVietnamLocation, locationCanContinue, roundedLocation, type LocationSelection } from "@/lib/listing-location";
import { httpMediaUrl } from "@/lib/listing-links";

function Frame({ title, admin = false, children }: { title: string; admin?: boolean; children: ReactNode }) {
  return <section className={`${admin ? "admin-homestay-page" : "host-stitch-page"} mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6`}><h1 className="text-xl font-semibold">{title}</h1>
    {admin ? <AdminNavigation /> : <nav aria-label="Tin cho thuê" className="flex flex-wrap gap-4"><Link href="/host/properties" className="text-link inline-flex min-h-11 items-center">Tin trọ của tôi</Link><Link href="/host/homestays" className="text-link inline-flex min-h-11 items-center">Homestay của tôi</Link></nav>}{children}</section>;
}
function Loading() { return <p role="status">Đang tải homestay…</p>; }
function ReadError({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="space-y-3"><Alert>{apiError(error).message}</Alert><Button variant="secondary" onClick={retry}>Tải lại nội dung</Button></div>;
}
// One lock per mounted form/action panel; never retry a mutation or replace a stale version silently.
function useWrite(saved: () => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<ReturnType<typeof apiError> | null>(null);
  const controller = useRef<AbortController | null>(null), mounted = useRef(false), locked = useRef(false);
  const sessionId = useAuthStore(state => state.sessionId);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const stale = apiError(error).errorCode === "STALE_HOMESTAY_VERSION";
  async function run(operation: (signal: AbortSignal) => Promise<unknown>) {
    if (locked.current || stale) return;
    locked.current = true; controller.current = new AbortController(); setBusy(true); setError(null);
    const current = () => mounted.current && useAuthStore.getState().sessionId === sessionId;
    try { await operation(controller.current.signal); if (current()) saved(); }
    catch (failure) { if (current() && !controller.current.signal.aborted) setError(apiError(failure)); }
    finally { locked.current = false; if (current()) setBusy(false); }
  }
  return { busy, error, stale, run, fields: error ? apiError(error).fieldErrors : {} };
}
export function HomestayListScreen({ admin = false }: { admin?: boolean }) {
  const sessionId = useAuthStore(state => state.sessionId);
  const content = <List key={sessionId} admin={admin} sessionId={sessionId} />;
  return <Frame title={admin ? "Duyệt homestay" : "Homestay của tôi"} admin={admin}>{admin ? <AdminAccess>{() => content}</AdminAccess> : <HostGate>{content}</HostGate>}</Frame>;
}
function List({ admin, sessionId }: { admin: boolean; sessionId: string | null }) {
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ["own-homestays", sessionId, admin, page], queryFn: ({ signal }) => hostHomestaysApi.list(page, admin, signal), retry: false, gcTime: 0 });
  return <div className="space-y-4">
    {!admin && <Link href="/host/homestays/create" className="button">Đăng homestay</Link>}
    {list.error ? <ReadError error={list.error} retry={() => void list.refetch()} /> : list.isPending ? <Loading /> : !list.data?.data.length ? <p>{admin ? "Không có homestay chờ duyệt." : "Bạn chưa có homestay. Chọn Đăng homestay để bắt đầu."}</p> : null}
    <ul className="space-y-3">{list.data?.data.map(record => !admin ? <li key={record.id} className="host-homestay-card">
      <div className="host-homestay-card-content">
        <HomestayThumbnail key={record.images?.[0]?.url || "empty"} url={httpMediaUrl(record.images?.[0]?.url)} title={record.title} />
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-0 break-words text-base font-semibold">{record.title}</h2><span className="status-pill">{listingStatuses[record.status] || record.status}</span></div>
          <p className="text-sm text-muted break-words">{record.addressDetail}</p>
          <p className="text-sm text-muted">{record.homestayUnits.length} phòng</p>
          {record.revision && <p className="text-sm text-muted">Bản sửa: {listingStatuses[record.revision.status] || record.revision.status}</p>}
        </div>
      </div>
      <div className="host-homestay-card-actions"><Link href={`/host/homestays/${record.id}`} className="button button-secondary">Quản lý homestay và phòng</Link></div>
    </li> : <li key={record.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-0 break-words text-base font-semibold">{record.title}</h2><span className="status-pill">{listingStatuses[record.status] || record.status}</span></div>
      <p className="text-sm text-muted">{record.homestayUnits.length} phòng · {record.addressDetail}</p>{record.revision && <p className="text-sm text-muted">Bản sửa: {listingStatuses[record.revision.status] || record.revision.status}</p>}
      <Link href={`/${admin ? "admin" : "host"}/homestays/${record.id}`} className="button button-secondary">{admin ? "Xem nội dung chờ duyệt" : "Quản lý homestay và phòng"}</Link></li>)}</ul>
    {(list.data?.meta.totalPages ?? 0) > 1 && <nav aria-label="Phân trang homestay" className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={page <= 1 || list.isFetching} onClick={() => setPage(page - 1)}>Trang trước</Button><span className="tabular-nums">Trang {page}/{list.data?.meta.totalPages}</span><Button variant="secondary" disabled={page >= (list.data?.meta.totalPages ?? 0) || list.isFetching} onClick={() => setPage(page + 1)}>Trang sau</Button></nav>}
  </div>;
}
function HomestayThumbnail({ url, title }: { url: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="host-homestay-thumbnail">
    {url && !failed ? <Image src={url} alt={title} unoptimized width={280} height={210} onError={() => setFailed(true)} className="h-full w-full object-cover" />
      : <div className="host-homestay-placeholder">{failed ? <ImageOff aria-hidden="true" className="size-5" /> : <Camera aria-hidden="true" className="size-5" />}<span>{failed ? "Không tải được ảnh" : "Chưa có ảnh"}</span></div>}
  </div>;
}
export function HomestayEditorScreen({ id }: { id?: string }) {
  const sessionId = useAuthStore(state => state.sessionId);
  return <Frame title={id ? "Sửa homestay" : "Đăng homestay"}><HostGate>{!id && <ListingTypeNavigation active="homestay" />}<Editor key={`${sessionId}:${id || "new"}`} id={id} sessionId={sessionId} /></HostGate></Frame>;
}
function Editor({ id, sessionId }: { id?: string; sessionId: string | null }) {
  const record = useQuery({ queryKey: ["own-homestay", sessionId, id], queryFn: ({ signal }) => hostHomestaysApi.detail(id!, false, signal), enabled: Boolean(id), retry: false, gcTime: 0, staleTime: Infinity, refetchOnWindowFocus: false });
  const [reload, setReload] = useState(0);
  if (id && record.error) return <ReadError error={record.error} retry={() => void record.refetch()} />;
  if (id && record.isPending) return <Loading />;
  return <ContentForm key={`${reload}:${record.data?.version || "new"}`} record={record.data} reload={() => { void record.refetch().then(result => { if (result.isSuccess) setReload(value => value + 1); }); }} />;
}
function ContentForm({ record, reload }: { record?: OwnHomestay; reload: () => void }) {
  const initial = homestayFormContent(record), router = useRouter(), cache = useQueryClient();
  const [province, setProvince] = useState(initial.provinceCode || ""), [ward, setWard] = useState(initial.wardCode || "");
  const [location, setLocation] = useState<LocationSelection>(() => {
    const point = initial.latitude != null && initial.longitude != null ? roundedLocation(Number(initial.latitude), Number(initial.longitude)) : null;
    return { point: isVietnamLocation(point) ? point : null, confirmed: false, moving: false };
  });
  const [locationError, setLocationError] = useState("");
  const provinces = useQuery({ queryKey: ["address-provinces"], queryFn: ({ signal }) => addressCatalog("provinces", "", signal), meta: { public: true }, retry: false });
  const wards = useQuery({ queryKey: ["address-wards", province], queryFn: ({ signal }) => addressCatalog("wards", province, signal), enabled: Boolean(province), meta: { public: true }, retry: false });
  const amenities = useQuery({ queryKey: ["listing-amenities"], queryFn: () => listingsApi.getAmenities(), meta: { public: true }, retry: false });
  const write = useWrite(() => { void cache.invalidateQueries({ queryKey: ["own-homestays"] }); router.push("/host/homestays"); });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!locationCanContinue(location) || !provinces.data?.items.some(item => item.code === province) || !wards.data?.items.some(item => item.code === ward)) {
      setLocationError("Chọn tỉnh, phường/xã hợp lệ và xác nhận vị trí trước khi gửi."); form.querySelector<HTMLElement>('[aria-label="Bản đồ chọn vị trí phòng"]')?.focus(); return;
    }
    if (provinces.isError || wards.isError || amenities.isError || amenities.isPending) return;
    const data = new FormData(form);
    void write.run(signal => hostHomestaysApi.save(homestayContent(data, initial.imageUrls || []), record, record ? undefined : homestayUnitInput(data), signal));
  }
  return <form onSubmit={submit} className="host-stitch-form space-y-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
    <p className="text-sm text-muted">Tin mới và bản sửa cần Admin duyệt. Bản đã duyệt giữ nguyên đến khi bản sửa được duyệt.</p>
    {write.error && <Alert>{apiError(write.error).message}</Alert>}{write.stale && <Button type="button" variant="secondary" onClick={reload}>Tải lại nội dung mới nhất</Button>}
    <fieldset disabled={write.busy || write.stale} className="space-y-4"><legend className="mb-3 text-base font-semibold">Thông tin và địa chỉ</legend>
      <Input name="title" label="Tên homestay" required maxLength={255} defaultValue={initial.title || ""} error={write.fields.title} />
      <label className="field">Loại hình<select className="field-control" name="propertyType" defaultValue={initial.propertyType || "HOMESTAY"}><option value="HOMESTAY">Homestay</option><option value="VILLA">Villa</option></select></label>
      <label className="field" htmlFor="description">Mô tả<textarea className="field-control min-h-32" id="description" name="description" required maxLength={10000} defaultValue={initial.description || ""} />{write.fields.description && <span className="field-error">{write.fields.description}</span>}</label>
      {provinces.error || wards.error ? <ReadError error={provinces.error || wards.error} retry={() => { void provinces.refetch(); if (province) void wards.refetch(); }} /> : null}
      <div className="grid gap-4 sm:grid-cols-2"><AddressCombobox name="provinceCode" label="Tỉnh/thành phố" value={province} items={provinces.data?.items || []} loading={provinces.isPending} disabled={provinces.isPending || provinces.isError || write.busy}
        onChange={code => { if (code !== province) { setProvince(code); setWard(""); setLocation({ point: null, confirmed: false, moving: false }); } }} />
        <AddressCombobox key={province} name="wardCode" label="Phường/xã" value={ward} items={wards.data?.items || []} loading={Boolean(province) && wards.isPending} disabled={!province || wards.isFetching || wards.isError || write.busy} hint={!province ? "Chọn tỉnh/thành phố trước." : undefined}
          onChange={code => { if (code !== ward) { setWard(code); setLocation({ point: null, confirmed: false, moving: false }); } }} /></div>
      <ListingLocationPicker provinceCode={province} wardCode={ward} provinceName={provinces.data?.items.find(item => item.code === province)?.name || ""} wardName={wards.data?.items.find(item => item.code === ward)?.name || ""}
        initialAddress={initial.addressDetail || ""} selection={location} onChange={next => { setLocation(next); setLocationError(""); }} addressError={write.fields.addressDetail} locationError={locationError || write.fields.latitude || write.fields.longitude} active disabled={write.busy || write.stale} />
      <Input name="videoUrl" label="URL video (không bắt buộc)" type="url" maxLength={2048} defaultValue={initial.videoUrl || ""} error={write.fields.videoUrl} />
    </fieldset>
    <fieldset disabled={write.busy || write.stale} className="space-y-3"><legend className="mb-3 text-base font-semibold">Tiện ích</legend>{amenities.error ? <ReadError error={amenities.error} retry={() => void amenities.refetch()} /> : amenities.isPending ? <Loading /> : <div className="grid gap-3 sm:grid-cols-2">{amenities.data?.map(item => <label key={item.id} className="amenity-chip"><input type="checkbox" name="amenityIds" value={item.id} defaultChecked={initial.amenityIds?.includes(item.id)} /><span>{item.name}</span></label>)}</div>}</fieldset>
    {!record && <fieldset disabled={write.busy || write.stale} className="space-y-4"><legend className="mb-3 text-base font-semibold">Phòng đầu tiên</legend><UnitFields errors={write.fields} /></fieldset>}
    <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4"><Link className="button button-secondary" href="/host/homestays">Quay lại danh sách</Link><Button type="submit" disabled={write.busy || write.stale || provinces.isError || wards.isError || amenities.isError || amenities.isPending} aria-busy={write.busy}>{write.busy ? "Đang gửi…" : "Gửi duyệt homestay"}</Button></div>
  </form>;
}
export function UnitFields({ unit, errors = {} }: { unit?: OwnUnit; errors?: Record<string, string> }) {
  const values = unit?.pendingRevision ?? unit;
  const value = (name: keyof UnitInput, fallback = "") => String(values?.[name] ?? fallback);
  return <div className="space-y-4"><Input name="unitName" label="Tên phòng" required maxLength={150} defaultValue={value("unitName")} error={errors.unitName} />
    <div className="grid gap-4 sm:grid-cols-2">{([['maxAdults', 'Tối đa người lớn', 1, 10000], ['maxChildren', 'Tối đa trẻ em', 0, 10000], ['maxGuests', 'Tổng sức chứa (không bắt buộc)', 1, 10000], ['maxNights', 'Số đêm tối đa', 1, 90], ['bedrooms', 'Số phòng ngủ', 0, 10000], ['bathrooms', 'Số phòng tắm', 0, 10000]] as const).map(([name, label, min, max]) => <Input key={name} name={name} label={label} type="number" min={min} max={max} step={1} required={name !== "maxGuests"} defaultValue={value(name, name === "maxNights" ? "90" : "")} error={errors[name]} />)}</div>
    <div className="grid gap-4 sm:grid-cols-2"><Input name="basePricePerNight" label="Giá ngày thường (đ/đêm)" type="number" min={0} max={9999999999999.99} step="0.01" required defaultValue={value("basePricePerNight")} error={errors.basePricePerNight} />
      <Input name="weekendPricePerNight" label="Giá cuối tuần (không bắt buộc)" type="number" min={0} max={9999999999999.99} step="0.01" defaultValue={value("weekendPricePerNight")} hint="Để trống dùng giá ngày thường. Cuối tuần là đêm thứ Sáu và thứ Bảy." error={errors.weekendPricePerNight} />
      <Input name="cleaningFee" label="Phí vệ sinh (đ/lần ở)" type="number" min={0} max={9999999999.99} step="0.01" required defaultValue={value("cleaningFee")} error={errors.cleaningFee} /></div>
    <div className="grid gap-4 sm:grid-cols-3">{([['checkInTime', 'Giờ nhận phòng'], ['checkOutTime', 'Giờ trả phòng'], ['sameDayBookingCutoff', 'Giờ chốt đặt trong ngày']] as const).map(([name, label]) => <Input key={name} name={name} label={`${label} (giờ Việt Nam)`} type="time" step={1} required defaultValue={unitTime(value(name, name === "sameDayBookingCutoff" ? "18:00:00" : ""))} error={errors[name]} />)}</div>
    <label className="field">Chính sách hủy<select name="cancellationPolicy" className="field-control" defaultValue={value("cancellationPolicy", "FLEXIBLE")}><option value="FLEXIBLE">Linh hoạt</option><option value="MODERATE">Trung bình</option><option value="STRICT">Nghiêm ngặt</option></select></label>
    <label className="amenity-chip"><input type="checkbox" name="instantBook" defaultChecked={Boolean(values?.instantBook)} /><span>Đặt tức thì (không cần Host chấp nhận yêu cầu)</span></label>
    <p className="text-sm text-muted">Giờ và giá do máy chủ kiểm tra. Hoa hồng, phí dịch vụ khách và thuế do Admin quản lý; không sửa tại đây.</p>
  </div>;
}
export function HomestayDetailScreen({ id, admin = false }: { id: string; admin?: boolean }) {
  const sessionId = useAuthStore(state => state.sessionId);
  const content = <Detail key={`${sessionId}:${id}`} id={id} sessionId={sessionId} admin={admin} />;
  return <Frame title={admin ? "Nội dung homestay chờ duyệt" : "Quản lý homestay và phòng"} admin={admin}>{admin ? <AdminAccess>{() => content}</AdminAccess> : <HostGate>{content}</HostGate>}</Frame>;
}
function Detail({ id, admin, sessionId }: { id: string; admin: boolean; sessionId: string | null }) {
  const [unit, setUnit] = useState<OwnUnit | "new" | null>(null), [remove, setRemove] = useState<OwnUnit | "property" | null>(null), [notice, setNotice] = useState("");
  const cache = useQueryClient(), router = useRouter();
  const amenities = useQuery({ queryKey: ["listing-amenities"], queryFn: () => listingsApi.getAmenities(), meta: { public: true }, retry: false });
  const record = useQuery({ queryKey: ["own-homestay", sessionId, id, admin], queryFn: ({ signal }) => hostHomestaysApi.detail(id, admin, signal), retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const write = useWrite(() => { setRemove(null); setNotice("Đã cập nhật homestay."); void cache.invalidateQueries({ queryKey: ["own-homestays"] }); void record.refetch(); });
  if (record.error) return <ReadError error={record.error} retry={() => void record.refetch()} />;
  if (!record.data) return <Loading />;
  const property = record.data, content = homestayFormContent(admin && property.revision?.status !== "PENDING_REVIEW" ? { ...property, revision: null } : property), busy = write.busy || write.stale || record.isFetching;
  const pending = property.status === "PENDING_REVIEW" || property.revision?.status === "PENDING_REVIEW" || property.homestayUnits.some(item => item.status === "PENDING_REVIEW" || item.pendingRevision);
  return <div className="space-y-6">
    {notice && <p role="status" className="form-success">{notice}</p>}{write.error && <Alert>{apiError(write.error).message}</Alert>}
    {write.stale && <Button variant="secondary" onClick={() => window.location.reload()}>Tải lại trang trước khi thao tác</Button>}
    <article className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5"><h2 className="break-words text-base font-semibold">{admin ? content.title : property.title}</h2><p className="text-sm">{listingStatuses[property.status] || property.status}</p>
      {property.revision && <p className="text-sm text-muted">Bản sửa {listingStatuses[property.revision.status] || property.revision.status}. {property.revision.status === "PENDING_REVIEW" ? "Nội dung chờ duyệt hiển thị bên dưới; bản công khai chưa bị thay thế." : admin ? "Bên dưới là nội dung hiện tại, không phải bản sửa đã bị từ chối." : "Bạn có thể sửa lại nội dung đã bị từ chối và gửi duyệt lại."}</p>}
      <p className="break-words text-sm">{content.addressDetail} · Mã tỉnh {content.provinceCode} · Mã phường/xã {content.wardCode}</p><p className="whitespace-pre-wrap break-words text-sm">{content.description}</p>
      <p className="text-sm">Loại hình: {content.propertyType === "VILLA" ? "Villa" : "Homestay"} · Vị trí: {Number(content.latitude).toFixed(6)}, {Number(content.longitude).toFixed(6)}</p>
      <p className="break-words text-sm">Tiện ích: {content.amenityIds?.length ? content.amenityIds.map(id => amenities.data?.find(item => item.id === id)?.name || id).join(", ") : "Chưa chọn tiện ích"}</p>
      {content.videoUrl && <p className="break-all text-sm">Video: {/^https?:\/\//i.test(content.videoUrl) ? <a className="text-link" href={content.videoUrl} target="_blank" rel="noopener noreferrer">{content.videoUrl}</a> : content.videoUrl}</p>}
      <ListingGallery title={content.title || property.title} images={(content.imageUrls || []).map((url, position) => ({ url, position, sortOrder: position }))} />
      {!admin && <div className="grid gap-3 sm:flex sm:flex-wrap"><Link className="button button-secondary" href={`/host/homestays/${id}/edit`}>Sửa thông tin homestay</Link>{["PUBLISHED", "HIDDEN"].includes(property.status) && <Button variant="secondary" disabled={busy} onClick={() => void write.run(signal => hostHomestaysApi.action(property, property.status === "PUBLISHED" ? "hide" : "show", undefined, signal))}>{property.status === "PUBLISHED" ? "Ẩn tin" : "Hiện tin"}</Button>}<Button variant="secondary" disabled={busy} onClick={() => setRemove("property")}>Xóa homestay</Button></div>}
    </article>
    <section className="space-y-4"><h2 className="text-lg font-semibold">Các phòng</h2>{property.homestayUnits.length === 0 && <p>Chưa có phòng.</p>}
      <ul className="space-y-3">{property.homestayUnits.map(item => { const values = admin ? item.pendingRevision ?? item : item; return <li key={item.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5"><h3 className="break-words text-base font-semibold">{values.unitName}</h3><p className="text-sm">{listingStatuses[item.status] || item.status}{item.pendingRevision ? " · Có bản sửa chờ duyệt" : ""}</p>
        <p className="text-sm">Người lớn: {values.maxAdults} · Trẻ em: {values.maxChildren}{values.maxGuests != null ? ` · Tổng: ${values.maxGuests}` : ""} · Tối đa {values.maxNights} đêm</p>
        <p className="text-sm">Phòng ngủ: {values.bedrooms} · Phòng tắm: {values.bathrooms}</p>
        <p className="text-sm">Ngày thường: {String(values.basePricePerNight)} đ · Cuối tuần: {values.weekendPricePerNight == null ? "Theo ngày thường" : `${values.weekendPricePerNight} đ`} · Vệ sinh: {String(values.cleaningFee)} đ</p>
        <p className="text-sm">Nhận {unitTime(values.checkInTime)} · Trả {unitTime(values.checkOutTime)} · Chốt đặt trong ngày {unitTime(values.sameDayBookingCutoff)} (giờ Việt Nam)</p><p className="text-sm">{values.instantBook ? "Đặt tức thì" : "Cần Host chấp nhận"} · Hủy: {{ FLEXIBLE: "Linh hoạt", MODERATE: "Trung bình", STRICT: "Nghiêm ngặt" }[values.cancellationPolicy]}</p>
        {!admin && <div className="grid gap-3 sm:flex sm:flex-wrap"><Button variant="secondary" disabled={busy} onClick={() => setUnit(item)}>Sửa phòng</Button><Button variant="secondary" disabled={busy} onClick={() => setRemove(item)}>Xóa phòng</Button><Link className="button button-secondary" href="/host/calendar">Lịch và giá phòng</Link></div>}</li>; })}</ul>
      {!admin && <Button disabled={busy} onClick={() => setUnit("new")}>Thêm phòng</Button>}
    </section>
    {admin && <div className="flex flex-wrap gap-3"><Button disabled={busy || !pending} onClick={() => void write.run(signal => hostHomestaysApi.action(property, "approve", undefined, signal))}>Duyệt toàn bộ nội dung chờ</Button><Button variant="secondary" disabled={busy || !pending} onClick={() => void write.run(signal => hostHomestaysApi.action(property, "reject", undefined, signal))}>Từ chối toàn bộ nội dung chờ</Button></div>}
    {unit && <UnitEditor key={unit === "new" ? `new:${property.version}` : `${unit.id}:${unit.version}`} record={property} unit={unit === "new" ? undefined : unit} close={() => { setUnit(null); void record.refetch(); }} saved={() => { setUnit(null); void record.refetch(); void cache.invalidateQueries({ queryKey: ["own-homestays"] }); }} />}
    <Dialog open={Boolean(remove)} onOpenChange={open => { if (!open && !write.busy) setRemove(null); }}><DialogContent onEscapeKeyDown={event => { if (write.busy) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}><DialogHeader><DialogTitle>Xác nhận xóa {remove === "property" ? "homestay" : "phòng"}?</DialogTitle><DialogDescription>Dữ liệu được xóa mềm, lịch sử đặt phòng vẫn giữ. Nếu còn đơn hiệu lực, máy chủ sẽ chặn xóa; bạn có thể ẩn tin.</DialogDescription></DialogHeader>
      {write.error && <Alert>{apiError(write.error).message}</Alert>}<DialogFooter><Button variant="secondary" disabled={write.busy} onClick={() => setRemove(null)}>Giữ lại</Button><Button variant="secondary" disabled={busy} onClick={() => { if (remove) void write.run(async signal => { await hostHomestaysApi.action(property, "delete", remove === "property" ? undefined : remove, signal); if (remove === "property") router.push("/host/homestays"); }); }}>Xác nhận xóa</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
function UnitEditor({ record, unit, close, saved }: { record: OwnHomestay; unit?: OwnUnit; close: () => void; saved: () => void }) {
  const write = useWrite(saved);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (event.currentTarget.reportValidity()) { const form = new FormData(event.currentTarget); void write.run(signal => hostHomestaysApi.unit(record, homestayUnitInput(form), unit, signal)); } }
  return <Dialog open onOpenChange={open => { if (!open && !write.busy) close(); }}><DialogContent className="homestay-unit-dialog" onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (write.busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{unit ? "Sửa phòng" : "Thêm phòng"}</DialogTitle><DialogDescription>Nội dung gửi lại để Admin duyệt. Bản đã duyệt và giá chụp của đơn cũ không bị thay đổi.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4">{write.error && <Alert>{apiError(write.error).message}</Alert>}{write.stale && <p className="text-sm">Đóng form và tải lại homestay để lấy phiên bản mới; không gửi lại phiên bản cũ.</p>}<fieldset disabled={write.busy || write.stale}><UnitFields unit={unit} errors={write.fields} /></fieldset><DialogFooter><Button type="button" variant="secondary" disabled={write.busy} onClick={close}>Quay lại</Button><Button type="submit" disabled={write.busy || write.stale} aria-busy={write.busy}>{write.busy ? "Đang gửi…" : "Gửi duyệt phòng"}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
