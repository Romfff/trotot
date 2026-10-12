import { httpMediaUrl } from "@/lib/listing-links";

const compactNumber = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

export function homestayCoverUrl(media: { url: string; sortOrder: number }[] = []): string | null {
  return [...media].sort((a, b) => a.sortOrder - b.sortOrder).map(image => httpMediaUrl(image.url)).find(Boolean) ?? null;
}

// Display labels only; full prices and ISO dates remain in API values and quotes.
export function calendarPriceLabel(price: number): string {
  if (price >= 1_000_000_000) return `${compactNumber.format(price / 1_000_000_000)}tỷ`;
  if (price >= 1_000_000) return `${compactNumber.format(price / 1_000_000)}tr`;
  if (price >= 1_000) return `${compactNumber.format(price / 1_000)}k`;
  return `${compactNumber.format(price)}đ`;
}

export function stayDateLabel(isoDate: string): string {
  return isoDate.split("-").reverse().join("/");
}
