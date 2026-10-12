import { httpMediaUrl, listingDetailHref, listingDisplayTitle } from "@/lib/listing-links";
import type { PublicListingItem } from "@/types/listing";

export function createListingPopup(room: PublicListingItem): HTMLDivElement {
  const popup = document.createElement("div");
  popup.className = "max-w-[220px] p-1";
  const imageUrl = httpMediaUrl(room.images[0]?.url);
  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = listingDisplayTitle(room.title);
    image.className = "w-full h-[95px] object-cover rounded-lg mb-1.5";
    image.loading = "lazy";
    popup.append(image);
  }

  const price = document.createElement("div");
  price.className = "font-bold text-sm text-ink mb-0.5";
  price.textContent = `${new Intl.NumberFormat("vi-VN").format(room.monthlyPrice)} đ/tháng`;
  const title = document.createElement("div");
  title.className = "text-[13px] text-ink mb-1 line-clamp-2 leading-[1.35]";
  title.textContent = listingDisplayTitle(room.title);
  const address = document.createElement("div");
  address.className = "text-[13px] text-muted mb-2";
  address.textContent = `${room.areaSqm} m² · ${room.ward?.name || room.addressDetail}`;
  const link = document.createElement("a");
  link.href = listingDetailHref(room.slug);
  link.className = "block text-center px-3 py-1.5 bg-brand text-white rounded-lg text-[13px] font-medium no-underline";
  // Leaflet's unlayered anchor rule overrides Tailwind's text-white utility.
  link.style.color = "#ffffff";
  link.textContent = "Xem phòng";
  popup.append(price, title, address, link);
  return popup;
}
