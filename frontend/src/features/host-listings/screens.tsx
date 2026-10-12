"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Camera } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthStore } from "@/stores/auth-store";
import { apiError } from "@/lib/api/client";
import { listingsApi } from "@/lib/api/listings";
import { addressCatalog, hostListingsApi, listingContactError, listingFormPayload, listingFormValues, listingStatuses, type OwnListing } from "@/lib/api/host-listings";
import { isVietnamLocation, locationCanContinue, roundedLocation, type LocationSelection } from "@/lib/listing-location";
import { ListingLocationPicker } from "./location-picker";
import { AddressCombobox } from "./address-combobox";
import { ListingTypeNavigation } from "@/components/listing/listing-type-navigation";
import "./stitch-host.css";

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return <div className="host-stitch-page mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-xl font-semibold">{title}</h1><nav aria-label="Tin cho thuê" className="flex flex-wrap gap-4"><Link href="/host/properties" className="text-link inline-flex min-h-11 items-center">Tin trọ của tôi</Link><Link href="/host/homestays" className="text-link inline-flex min-h-11 items-center">Homestay của tôi</Link></nav></header>{children}
  </div>;
}

export function HostGate({ children }: { children: ReactNode }) {
  const { user, status } = useAuthStore();
  if (status === "initializing") return <p role="status" className="p-6">Đang kiểm tra phiên…</p>;
  if (!user) return <div className="space-y-4 p-6"><Alert>Cần đăng nhập để quản lý tin.</Alert><Link className="button" href="/login">Đăng nhập</Link></div>;
  if (user.role !== "HOST" || user.status !== "ACTIVE") return <div className="space-y-4 p-6"><Alert>Chức năng này dành cho chủ nhà có tài khoản đang hoạt động.</Alert><Link className="button button-secondary" href="/account">Đến tài khoản</Link></div>;
  return children;
}

function listingStatusBadge(status: string) {
  switch (status) {
    case "PUBLISHED":
      return "status-pill status-pill-confirmed";
    case "PENDING_REVIEW":
    case "HIDDEN":
      return "status-pill status-pill-pending";
    case "REJECTED":
      return "status-pill status-pill-cancelled";
    default:
      return "status-pill status-pill-completed";
  }
}

function ListingThumbnail({ url, title }: { url: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="w-full sm:w-28 h-32 sm:h-20 shrink-0 rounded-lg overflow-hidden bg-[#f4f7f5] relative border border-gray-100">
    {url && !failed ? <Image unoptimized width={200} height={150} src={url} alt={title}
      onError={() => setFailed(true)} className="w-full h-full object-cover" /> :
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted text-xs">
        <Camera className="w-4 h-4 text-muted/50" aria-hidden="true" />
        <span>{failed ? "Không tải được ảnh" : "Không có ảnh"}</span>
      </div>}
  </div>;
}

export function HostListingsScreen() {
  const sessionId = useAuthStore(state => state.sessionId);
  return <Frame title="Quản lý tin trọ"><HostGate><OwnList key={sessionId} sessionId={sessionId} /></HostGate></Frame>;
}

function OwnList({ sessionId }: { sessionId: string | null }) {
  const [page, setPage] = useState(1);
  const [stale, setStale] = useState(false);
  const [remove, setRemove] = useState<OwnListing | null>(null);
  const [message, setMessage] = useState("");
  const cache = useQueryClient();
  const list = useQuery({ queryKey: ["host-listings", sessionId, page], queryFn: ({ signal }) => hostListingsApi.list(page, signal), retry: false });
  const mutation = useMutation({ mutationFn: ({ record, action }: { record: OwnListing; action: "hide" | "show" | "availability" | "delete" }) => hostListingsApi.action(record, action, !record.isAvailable),
    onSuccess: async () => { setRemove(null); setMessage("Đã cập nhật tin."); await cache.invalidateQueries({ queryKey: ["host-listings", sessionId] }); },
    onError: error => { if (apiError(error).errorCode === "STALE_LISTING_VERSION") setStale(true); },
  });
  const busy = mutation.isPending || list.isFetching || list.isError || stale;
  async function reload() { const result = await list.refetch(); if (result.isSuccess) { setStale(false); mutation.reset(); setMessage(""); } }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white border border-gray-200 rounded-xl">
      <p className="text-sm text-muted">Gói miễn phí: tối đa 2 tin đang chờ duyệt, hiển thị hoặc tạm ẩn.</p>
      <Link className="button min-h-11 inline-flex items-center" href="/host/properties/create">Đăng tin trọ</Link>
    </div>
    {message ? <p role="status" className="form-success rounded-lg p-4">{message}</p> : null}
    {mutation.error ? <Alert>{apiError(mutation.error).message}</Alert> : null}
    {list.error ? <Alert>{apiError(list.error).message}</Alert> : null}
    {stale || list.isError ? <Button variant="secondary" disabled={list.isFetching} onClick={() => void reload()}>Tải lại danh sách</Button> : null}
    {list.isPending ? <p role="status">Đang tải tin…</p> : list.data?.data.length === 0 ? <p className="rounded-xl border border-gray-200 bg-white p-6">Bạn chưa có tin trọ. Chọn “Đăng tin trọ” để bắt đầu.</p> : null}
    <ul className="space-y-3">{list.data?.data.map(record => {
      const firstImage = record.images && record.images.length > 0 ? record.images[0].url : null;
      return <li key={record.id} className="host-listing-row space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5 transition-shadow hover:shadow-xs">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <ListingThumbnail key={firstImage} url={firstImage} title={record.title} />
          <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start justify-between gap-2 w-full">
            <div className="min-w-0 space-y-1">
              <h2 className="break-words text-base font-semibold text-ink leading-snug">{record.title}</h2>
              <p className="text-sm text-muted break-words">{record.addressDetail}</p>
              <p className="text-xs text-muted">
                Trạng thái phòng: <span className={record.isAvailable ? "text-emerald-700 font-medium" : "text-amber-700 font-medium"}>{record.isAvailable ? "Còn phòng" : "Đã hết phòng"}</span>
              </p>
            </div>
            <div className="shrink-0 self-start">
              <span className={listingStatusBadge(record.status)}>{listingStatuses[record.status] || record.status}</span>
            </div>
          </div>
        </div>
        {record.revision ? (
          <div className="rounded-lg bg-amber-50/70 border border-amber-200/80 p-3 text-xs text-amber-900 flex items-start gap-2">
            <span className="font-semibold shrink-0">Bản sửa ({listingStatuses[record.revision.status] || record.revision.status}):</span>
            <span>Bản đã duyệt không bị thay thế trước khi Admin duyệt lại.</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
          <Link className="button button-secondary min-h-10 text-sm font-medium" href={`/host/properties/${record.id}/edit`}>Xem và sửa tin</Link>
          {["PUBLISHED", "HIDDEN"].includes(record.status) ? <>
            <Button variant="secondary" className="min-h-10 text-sm" disabled={busy} onClick={() => mutation.mutate({ record, action: record.status === "PUBLISHED" ? "hide" : "show" })}>{record.status === "PUBLISHED" ? "Ẩn tin" : "Hiện tin"}</Button>
            <Button variant="secondary" className="min-h-10 text-sm" disabled={busy} onClick={() => mutation.mutate({ record, action: "availability" })}>{record.isAvailable ? "Báo hết phòng" : "Báo còn phòng"}</Button>
          </> : null}
          <Button variant="secondary" className="min-h-10 text-sm text-rose-700 hover:text-rose-800 hover:bg-rose-50 border-rose-200 sm:ml-auto" disabled={busy} onClick={() => { mutation.reset(); setRemove(record); }}>Xóa tin</Button>
        </div>
      </li>;
    })}</ul>
    {(list.data?.meta.totalPages ?? 0) > 1 ? <nav aria-label="Phân trang tin của tôi" className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>Trang trước</Button><span>Trang {page}/{list.data?.meta.totalPages}</span><Button variant="secondary" disabled={page >= (list.data?.meta.totalPages ?? 0) || busy} onClick={() => setPage(page + 1)}>Trang sau</Button></nav> : null}
    <Dialog open={Boolean(remove)} onOpenChange={open => { if (!mutation.isPending && !open) setRemove(null); }}><DialogContent>
      <DialogHeader><DialogTitle>Xóa tin trọ?</DialogTitle><DialogDescription>Tin “{remove?.title}” sẽ được xóa mềm. Lịch hẹn được giữ lại; tin có lịch hẹn sắp tới chỉ được ẩn.</DialogDescription></DialogHeader>
      {mutation.error ? <Alert>{apiError(mutation.error).message}</Alert> : null}
      <DialogFooter><Button variant="secondary" disabled={mutation.isPending} onClick={() => setRemove(null)}>Giữ lại</Button><Button variant="secondary" className="bg-rose-50 text-rose-700" disabled={busy} onClick={() => remove && mutation.mutate({ record: remove, action: "delete" })}>{mutation.isPending ? "Đang xóa…" : "Xác nhận xóa"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

export function HostListingEditor({ id }: { id?: string }) {
  const sessionId = useAuthStore(state => state.sessionId);
  return <Frame title={id ? "Sửa tin trọ" : "Đăng tin trọ"}><HostGate>{!id && <ListingTypeNavigation active="long-term" />}<EditorLoader key={`${sessionId}:${id || "new"}`} id={id} sessionId={sessionId} /></HostGate></Frame>;
}

function EditorLoader({ id, sessionId }: { id?: string; sessionId: string | null }) {
  const detail = useQuery({ queryKey: ["host-listing-detail", sessionId, id], queryFn: ({ signal }) => hostListingsApi.detail(id!, signal), enabled: Boolean(id), retry: false, staleTime: Infinity, refetchOnWindowFocus: false });
  const [reload, setReload] = useState(0);
  if (id && detail.isPending) return <p role="status">Đang tải nội dung tin…</p>;
  if (id && detail.error) return <div className="space-y-4"><Alert>{apiError(detail.error).message}</Alert><Button variant="secondary" disabled={detail.isFetching} onClick={() => void detail.refetch()}>Thử lại</Button></div>;
  return <ListingForm key={`${reload}:${detail.data?.version ?? "new"}`} record={detail.data} onReload={async () => { const result = await detail.refetch(); if (result.isSuccess) setReload(n => n + 1); }} />;
}

const feeNames = new Set<string>(["electricityCost", "waterCost", "internetCost", "garbageCost", "parkingFee"]);

export function ListingFeeInput({ name, label, max, defaultValue, error, onValueChange }: { name: string; label: string; max: number; defaultValue: string; error?: string; onValueChange?: () => void }) {
  const [value, setValue] = useState(defaultValue);
  return <div className="listing-fee-field space-y-1.5 min-w-0">
    <Input name={name} label={label} type="number" required min={0} max={max} step="0.01" value={value} error={error}
      onChange={event => { setValue(event.target.value); onValueChange?.(); }} />
    <Button type="button" variant="secondary" className="listing-fee-zero w-full whitespace-normal" aria-label={`${label}: Miễn phí / đã gồm trong giá thuê`}
      onClick={() => { setValue("0"); onValueChange?.(); }}>Miễn phí / đã gồm trong giá thuê</Button>
  </div>;
}

function ListingForm({ record, onReload }: { record?: OwnListing; onReload: () => Promise<void> }) {
  const router = useRouter(); const cache = useQueryClient();
  const initial = listingFormValues(record);
  const [step, setStep] = useState(0); const [province, setProvince] = useState(String(initial.provinceCode || "")); const [ward, setWard] = useState(String(initial.wardCode || ""));
  const [location, setLocation] = useState<LocationSelection>(() => {
    const point = initial.latitude !== "" && initial.longitude !== "" && initial.latitude != null && initial.longitude != null
      ? roundedLocation(Number(initial.latitude), Number(initial.longitude)) : null;
    return { point: isVietnamLocation(point) ? point : null, confirmed: false, moving: false };
  });
  const [stale, setStale] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const provinces = useQuery({ queryKey: ["address-provinces"], queryFn: ({ signal }) => addressCatalog("provinces", "", signal), meta: { public: true }, retry: false });
  const wards = useQuery({ queryKey: ["address-wards", province], queryFn: ({ signal }) => addressCatalog("wards", province, signal), enabled: Boolean(province), meta: { public: true }, retry: false });
  const amenities = useQuery({ queryKey: ["listing-amenities"], queryFn: () => listingsApi.getAmenities(), meta: { public: true }, retry: false });
  const mutation = useMutation({ mutationFn: (form: FormData) => hostListingsApi.save(listingFormPayload(form, Array.isArray(initial.imageUrls) ? initial.imageUrls : []), record),
    onSuccess: async () => { await cache.invalidateQueries({ queryKey: ["host-listings"] }); router.push("/host/properties"); },
    onError: error => { if (apiError(error).errorCode === "STALE_LISTING_VERSION") setStale(true); },
  });
  const fields = { ...(mutation.error ? apiError(mutation.error).fieldErrors : {}), ...validationErrors };
  const blocked = stale || mutation.isPending || provinces.isError || wards.isError || amenities.isError || !provinces.data?.items.some(item => item.code === province) || !wards.data?.items.some(item => item.code === ward) || !locationCanContinue(location);
  const value = (name: string) => String(initial[name] ?? "");
  function clearValidation(name: string) { setValidationErrors(previous => { const next = { ...previous }; delete next[name]; return next; }); }
  function validate(form: HTMLFormElement, onlyStep?: number) {
    const controls = Array.from(form.elements).filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)
      && (onlyStep === undefined || element.closest("fieldset")?.getAttribute("data-step") === String(onlyStep)));
    const invalidControls = controls.filter(element => !element.checkValidity());
    setValidationErrors(previous => {
      const next = { ...previous }; for (const element of controls) delete next[element.name];
      for (const element of invalidControls) next[element.name] = element.validity.valueMissing
        ? feeNames.has(element.name) ? "Cần kê khai khoản phí này. Chọn miễn phí / đã gồm trong giá thuê nếu giá là 0." : "Vui lòng điền trường này."
        : "Giá trị không hợp lệ. Kiểm tra định dạng và giới hạn của ô nhập.";
      return next;
    });
    const invalid = invalidControls[0];
    if (!invalid) {
      if (onlyStep === undefined || onlyStep === 0) {
        const addressField = !provinces.data?.items.some(item => item.code === province) ? "provinceCode" : !wards.data?.items.some(item => item.code === ward) ? "wardCode" : null;
        if (addressField) {
          setValidationErrors(previous => ({ ...previous, [addressField]: "Chọn địa chỉ hợp lệ từ danh mục." }));
          setStep(0); requestAnimationFrame(() => form.querySelector<HTMLElement>(`#${addressField}`)?.focus()); return false;
        }
      }
      if ((onlyStep === undefined || onlyStep === 0) && !locationCanContinue(location)) {
        setValidationErrors(previous => ({ ...previous, location: "Cần đặt ghim hợp lệ trong Việt Nam và xác nhận vị trí trước khi tiếp tục." }));
        setStep(0); requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-label="Bản đồ chọn vị trí phòng"]')?.focus()); return false;
      }
      return true;
    }
    setStep(Number(invalid.closest("fieldset")?.getAttribute("data-step") || 0));
    requestAnimationFrame(() => { invalid.focus(); invalid.reportValidity(); }); return false;
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!blocked && validate(event.currentTarget)) mutation.mutate(new FormData(event.currentTarget)); }
  return <form noValidate onSubmit={submit} onChangeCapture={event => { const element = event.target; if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) clearValidation(element.name); }} className="host-stitch-form space-y-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
    <ol aria-label="Các bước đăng tin" className="grid grid-cols-3 gap-4 text-sm sm:gap-8">
      {["Thông tin và địa chỉ", "Giá và tiện ích", "Liên hệ và gửi duyệt"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className="stepper-item relative flex min-w-0 flex-col items-center gap-2 text-center">
        <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-full font-semibold tabular-nums ${step === index ? "bg-brand-hover text-white" : index < step ? "bg-brand-tint text-brand-hover" : "bg-background text-muted"}`}>{index + 1}</span>
        <span className={`w-full min-w-0 text-balance ${step === index ? "font-semibold text-brand-hover" : "text-muted"}`}><span className="sr-only">{index + 1}. </span>{label}</span>
        {index < 2 ? <span aria-hidden="true" className="pointer-events-none absolute left-full top-0 flex h-8 w-4 items-center justify-center text-muted sm:w-8"><ChevronRight className="size-4 shrink-0" /></span> : null}
      </li>)}
    </ol>
    <p className="text-muted">Tin mới cần Admin duyệt. Sửa tin đã duyệt không thay bản đang hiển thị cho đến khi bản sửa được duyệt.</p>
    {mutation.error ? <Alert>{apiError(mutation.error).message}</Alert> : null}
    {stale ? <Button type="button" variant="secondary" onClick={() => void onReload()}>Tải lại nội dung mới nhất</Button> : null}
    {provinces.error || wards.error ? <div className="space-y-3"><Alert>{apiError(provinces.error || wards.error).message} Không dùng địa chỉ mẫu để gửi tin.</Alert><Button type="button" variant="secondary" onClick={() => { void provinces.refetch(); if (province) void wards.refetch(); }}>Tải lại địa chỉ</Button></div> : null}
    <fieldset data-step="0" hidden={step !== 0} disabled={mutation.isPending} className="space-y-4">
      <legend className="sr-only">Thông tin và địa chỉ</legend>
      <Input name="title" label="Tiêu đề" required maxLength={255} defaultValue={value("title")} error={fields.title} placeholder="Mô tả ngắn gọn phòng cần cho thuê" />
      <label className="field">Loại nhà<span className="host-property-select"><select name="propertyType" className="field-control" defaultValue={value("propertyType")} required>{[["PHONG_TRO", "Phòng trọ"], ["CHUNG_CU_MINI", "Chung cư mini"], ["NHA_NGUYEN_CAN", "Nhà nguyên căn"], ["O_GHEP", "Ở ghép"]].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><ChevronDown aria-hidden="true" /></span></label>
      <label className="field">Mô tả<textarea name="description" className="field-control min-h-32" rows={5} required maxLength={10000} defaultValue={value("description")} />{fields.description ? <span className="field-error">{fields.description}</span> : null}</label>
      <Input label="Nhập hoặc dán địa chỉ" id="listing-quick-address" disabled placeholder="Chưa kết nối tìm địa chỉ"
        hint="Chưa kết nối dịch vụ gợi ý địa chỉ. Chọn từng phần bên dưới và kéo bản đồ để đặt ghim." />
      <div className="grid gap-4 sm:grid-cols-2">
        <AddressCombobox name="provinceCode" label="Tỉnh/thành phố" value={province} items={provinces.data?.items || []} loading={provinces.isPending}
          error={fields.provinceCode} disabled={mutation.isPending || provinces.isPending || provinces.isError}
          onChange={code => { if (code !== province) { setProvince(code); setWard(""); setLocation({ point: null, confirmed: false, moving: false }); clearValidation("provinceCode"); clearValidation("wardCode"); } }} />
        <AddressCombobox key={province} name="wardCode" label="Phường/xã" value={ward} items={wards.data?.items || []} loading={Boolean(province) && wards.isPending}
          error={fields.wardCode} disabled={!province || wards.isFetching || wards.isError || mutation.isPending}
          hint={!province ? "Chọn tỉnh/thành phố trước." : undefined}
          onChange={code => { if (code !== ward) { setWard(code); setLocation({ point: null, confirmed: false, moving: false }); clearValidation("wardCode"); } }} />
      </div>
      <ListingLocationPicker provinceCode={province} wardCode={ward} provinceName={provinces.data?.items.find(item => item.code === province)?.name || ""}
        wardName={wards.data?.items.find(item => item.code === ward)?.name || ""} initialAddress={value("addressDetail")} selection={location}
        onChange={next => { setLocation(next); clearValidation("location"); clearValidation("latitude"); clearValidation("longitude"); }}
        addressError={fields.addressDetail} locationError={fields.location || fields.latitude || fields.longitude} active={step === 0} disabled={mutation.isPending} />
    </fieldset>
    <fieldset data-step="1" hidden={step !== 1} disabled={mutation.isPending} className="space-y-6"><legend className="sr-only">Giá và tiện ích</legend>
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-foreground border-b border-gray-100 pb-2">Giá thuê và diện tích</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input name="monthlyPrice" label="Giá thuê/tháng (đ)" type="number" required min={0} max={9999999999999.99} step="0.01" defaultValue={value("monthlyPrice")} error={fields.monthlyPrice} placeholder="Ví dụ: 3500000" />
          <Input name="depositAmount" label="Tiền cọc (đ)" type="number" required min={0} max={9999999999999.99} step="0.01" defaultValue={value("depositAmount")} error={fields.depositAmount} placeholder="0 nếu không cọc" />
          <Input name="areaSqm" label="Diện tích (m²)" type="number" required min={0.01} max={9999.99} step="0.01" defaultValue={value("areaSqm")} error={fields.areaSqm} placeholder="Ví dụ: 25" />
        </div>
      </div>
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-foreground border-b border-gray-100 pb-2">Chi phí dịch vụ hàng tháng</h3>
        <p className="text-xs text-muted">Mọi khoản phí phải được kê khai. Bấm &quot;Miễn phí / đã gồm trong giá thuê&quot; nếu bằng 0; không được để trống khi gửi duyệt.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <ListingFeeInput name="electricityCost" label="Điện (đ/kWh)" max={9999999999.99} defaultValue={value("electricityCost")} error={fields.electricityCost} onValueChange={() => clearValidation("electricityCost")} />
          <ListingFeeInput name="internetCost" label="Internet (đ/tháng)" max={9999999999.99} defaultValue={value("internetCost")} error={fields.internetCost} onValueChange={() => clearValidation("internetCost")} />
          <div className="grid grid-cols-1 sm:grid-cols-2 sm:col-span-2 gap-4 items-start">
            <ListingFeeInput name="waterCost" label="Đơn giá nước (đ)" max={9999999999.99} defaultValue={value("waterCost")} error={fields.waterCost} onValueChange={() => clearValidation("waterCost")} />
            <label className="field">Đơn vị tính nước<select name="waterUnit" className="field-control" required defaultValue={value("waterUnit")}><option value="M3">Theo m³</option><option value="PERSON">Theo người/tháng</option></select></label>
          </div>
          <ListingFeeInput name="garbageCost" label="Rác (đ/phòng/tháng)" max={9999999999.99} defaultValue={value("garbageCost")} error={fields.garbageCost} onValueChange={() => clearValidation("garbageCost")} />
          <ListingFeeInput name="parkingFee" label="Phí gửi xe (đ/xe/tháng)" max={9999999999.99} defaultValue={value("parkingFee")} error={fields.parkingFee} onValueChange={() => clearValidation("parkingFee")} />
        </div>
      </div>
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-foreground border-b border-gray-100 pb-2">Tiện ích & quy định</h3>
        <div>
          <p className="mb-3 text-sm font-medium text-foreground">Tiện ích</p>
          {amenities.isPending ? <p role="status" className="text-sm text-muted">Đang tải tiện ích…</p> : amenities.error ? <><Alert>Chưa tải được tiện ích.</Alert><Button type="button" variant="secondary" onClick={() => void amenities.refetch()}>Tải lại tiện ích</Button></> : <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{amenities.data?.map(item => <label key={item.id} className="amenity-chip"><input type="checkbox" name="amenityIds" value={item.id} defaultChecked={Array.isArray(initial.amenityIds) && initial.amenityIds.includes(item.id)} /><span>{item.name}</span></label>)}</div>}
        </div>
        <div className="pt-1">
          <label className="amenity-chip"><input type="checkbox" name="allowPets" defaultChecked={initial.allowPets === true} /><span>Cho phép thú cưng</span></label>
        </div>
      </div>
    </fieldset>
    <fieldset data-step="2" hidden={step !== 2} disabled={mutation.isPending} className="space-y-4"><legend className="sr-only">Liên hệ và gửi duyệt</legend>
      <Input name="contactPhone" label="Số điện thoại liên hệ" type="tel" required maxLength={20} defaultValue={value("contactPhone")} error={listingContactError("contactPhone", fields.contactPhone)} />
      <Input name="contactZalo" label="Số Zalo (không bắt buộc)" type="tel" maxLength={20} defaultValue={value("contactZalo")} error={listingContactError("contactZalo", fields.contactZalo)} />
      <Input name="videoUrl" label="URL video (không bắt buộc)" type="url" maxLength={2048} defaultValue={value("videoUrl")} error={fields.videoUrl} hint="Chỉ lưu đường dẫn; chưa phải upload video lên server ảnh." />
      <p className="rounded-lg bg-brand-tint p-4">Upload ảnh đang chờ server riêng. Không thêm ảnh mẫu hoặc URL ngoài để giả upload; ảnh đã có được giữ nguyên khi gửi bản sửa. Yêu cầu tối đa 15 ảnh và 1 video vẫn chưa nghiệm thu.</p>
      <Button type="submit" disabled={blocked}>{mutation.isPending ? "Đang gửi…" : record ? "Gửi bản sửa để duyệt" : "Gửi tin để duyệt"}</Button>
    </fieldset>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={step === 0 || mutation.isPending} onClick={() => setStep(step - 1)}>Quay lại</Button>
        {step < 2 ? <Button type="button" disabled={mutation.isPending} onClick={event => { if (event.currentTarget.form && validate(event.currentTarget.form, step)) setStep(step + 1); }}>Tiếp tục</Button> : null}
      </div>
      <Link href="/host/properties" className="button button-secondary text-muted hover:text-foreground">Đóng form</Link>
    </div>
  </form>;
}
