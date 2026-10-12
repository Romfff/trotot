import type { Metadata } from "next";
import { listingMetadata } from "@/lib/listing-metadata";
import { listingStructuredData } from "@/lib/listing-structured-data";
import Link from "next/link";
import { Check, MapPin, ReceiptText } from "lucide-react";
import { getPublicListing } from "@/lib/api/public-listing.server";
import { httpMediaUrl, listingDisplayTitle, listingDisplayDescription } from "@/lib/listing-links";
import { CostEstimate } from "@/components/listing/CostEstimate";
import { AppointmentRequest } from "@/features/appointments/screens";
import { ListingGallery } from "@/components/listing/listing-gallery";
import { ListingContact } from "@/components/listing/listing-contact";
import { PropertySatelliteMap } from "@/components/listing/PropertySatelliteMap";
import { ChatLauncher } from "@/features/chat/chat";
import { Suspense } from "react";
import { NearbyServer } from "@/features/nearby/server";

export const dynamic = "force-dynamic";

const money = (value: number) => `${new Intl.NumberFormat("vi-VN").format(value)} đ`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return listingMetadata(await getPublicListing(slug), process.env.FRONTEND_ORIGIN);
}

export default async function ListingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const room = await getPublicListing(slug);
  const structuredData = listingStructuredData(room, process.env.FRONTEND_ORIGIN);
  const address = [room.addressDetail, room.ward?.name, room.ward?.province.name].filter(Boolean).join(", ");
  const videoUrl = httpMediaUrl(room.videoUrl);
  const fees = [
    ["Điện", `${money(room.electricityCost)} / kWh`],
    ["Nước", `${money(room.waterCost)} / ${room.waterUnit === "PERSON" ? "người" : "m³"}`],
    ["Internet", money(room.internetCost)],
    ["Gửi xe", `${money(room.parkingFee)} / xe / tháng`],
    ["Rác", `${money(room.garbageCost)} / phòng / tháng`],
  ];

  return (
    <div className="max-w-[1120px] mx-auto px-4 md:px-7 py-6">
      {structuredData && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />}
      
      {/* Breadcrumb Path */}
      <nav className="text-xs text-muted mb-3 flex flex-wrap items-center gap-1.5" aria-label="Đường dẫn trang">
        <Link href="/" className="inline-flex min-h-11 items-center hover:text-ink font-medium">Trang chủ</Link>
        <span>/</span>
        <Link href="/thue-phong-tro" className="inline-flex min-h-11 items-center hover:text-ink font-medium">Thuê trọ dài hạn</Link>
        <span>/</span>
        <span className="text-ink font-medium break-words">Chi tiết phòng</span>
      </nav>

      {/* Headline & Address */}
      <div className="mb-6">
        <h1 className="text-[24px] leading-[30px] md:text-[28px] md:leading-[35px] font-bold text-ink break-words tracking-tight">
          {listingDisplayTitle(room.title)}
        </h1>
        <div className="flex items-center gap-1.5 mt-2 text-sm text-muted">
          <MapPin className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
          <span className="break-words min-w-0">{address}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-x-8 gap-y-8 items-start">
        {/* Main Column: Gallery */}
        <div className="w-full min-w-0 lg:col-span-2">
          <ListingGallery key={room.id} title={listingDisplayTitle(room.title)} images={room.images} appearance="stitch" />
        </div>

        {/* Sticky Sidebar: Price & Actions */}
        <aside className="bg-white border border-gray-200 rounded-xl p-5 lg:col-start-2 lg:row-start-2 lg:sticky lg:top-20 min-w-0 w-full shadow-[0_4px_16px_rgba(16,48,43,0.06)]">
          <p className="text-xs text-muted font-medium">Giá thuê niêm yết</p>
          <p className="text-[28px] leading-[35px] font-bold text-ink mt-1 break-words tracking-tight">
            {money(room.monthlyPrice)}
            <span className="text-sm font-normal text-muted"> / tháng</span>
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-bg text-ink border border-gray-200">
              {room.areaSqm} m²
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${
                room.isAvailable ? "bg-brand-tint text-brand border border-gray-200 rounded-full" : "bg-bg text-muted border border-gray-200 rounded-full"
              }`}
            >
              {room.isAvailable ? "Còn phòng" : "Đã cho thuê"}
            </span>
          </div>
          <div className="border-t border-gray-200 mt-5 pt-5">
            <div className="flex items-center gap-3 mb-5 p-3 bg-bg border border-gray-200 rounded-lg">
              <div
                className="w-12 h-12 rounded-full bg-brand-tint text-brand font-bold text-lg flex items-center justify-center border border-gray-200 select-none shrink-0"
                aria-hidden="true"
              >
                {(room.host?.fullName || "Chủ nhà").trim().charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted font-medium">Chủ nhà</p>
                <p className="font-semibold text-ink text-sm break-words">
                  {room.host?.fullName || "Chưa cung cấp"}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <AppointmentRequest propertyId={room.id} title={listingDisplayTitle(room.title)} isAvailable={room.isAvailable} />
              <ListingContact slug={slug} />
              <ChatLauncher propertyId={room.id} />
            </div>
          </div>
        </aside>

        {/* Details Column */}
        <div className="w-full min-w-0 space-y-6 lg:col-start-1 lg:row-start-2">
          <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-[20px] leading-7 font-bold text-ink pb-4 mb-4 border-b border-gray-200 flex items-center gap-2"><ReceiptText size={22} className="text-brand shrink-0" aria-hidden="true" />Chi phí niêm yết</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="sm:col-span-2 p-3.5 bg-brand-tint border border-gray-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                <dt className="text-muted">Tiền thuê / tháng</dt>
                <dd className="text-[20px] font-bold text-brand">{money(room.monthlyPrice)}</dd>
              </div>
              <div className="p-3 bg-bg border border-gray-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                <dt className="text-muted">Tiền cọc</dt>
                <dd className="font-semibold text-ink">{money(room.depositAmount)}</dd>
              </div>
              {fees.map(([label, value]) => (
                <div key={label} className="p-3 bg-bg border border-gray-200 rounded-lg flex flex-wrap items-center justify-between gap-2">
                  <dt className="text-muted">{label}</dt>
                  <dd className="font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="min-w-0">
            <CostEstimate key={slug} slug={slug} waterUnit={room.waterUnit} />
          </div>

          <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-[20px] leading-7 font-bold text-ink mb-4">Tiện nghi có sẵn</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {room.amenities.map((amenity) => (
                <li key={amenity.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-bg border border-gray-200">
                  <Check size={20} className="text-brand shrink-0" aria-hidden="true" />
                  <span className="text-ink break-words min-w-0">{amenity.name}</span>
                </li>
              ))}
              {room.allowPets && (
                <li className="flex items-start gap-2 p-2.5 rounded-lg bg-bg border border-gray-200">
                  <Check size={20} className="text-brand shrink-0" aria-hidden="true" />
                  <span className="text-ink">Cho nuôi thú cưng</span>
                </li>
              )}
            </ul>
            {room.amenities.length === 0 && !room.allowPets && (
              <p className="text-sm text-muted">Chủ nhà chưa cung cấp tiện ích.</p>
            )}
          </section>

          {(listingDisplayDescription(room.description) || videoUrl) && (
            <section className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <h2 className="text-[20px] leading-7 font-bold text-ink mb-4">Mô tả từ chủ nhà</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-ink">
                {listingDisplayDescription(room.description)}
              </p>
              {videoUrl && (
                <a
                  href={videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-brand hover:underline font-medium text-sm"
                >
                  Xem video phòng
                </a>
              )}
            </section>
          )}

          <PropertySatelliteMap room={room} address={address} />

          <Suspense fallback={null}>
            <NearbyServer slug={slug} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

