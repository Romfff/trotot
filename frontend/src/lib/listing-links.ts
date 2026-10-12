export function listingDisplayTitle(title: string): string {
  return title.replace(/^\s*\[DEMO\]\s*/i, "");
}

export function listingDisplayDescription(description: string): string {
  return description.startsWith("LOCAL_DEMO_LISTINGS_V1\n") ? "" : description;
}

export function listingDetailHref(slug: string): string {
  return `/thue-phong-tro/${encodeURIComponent(slug)}`;
}

export function httpMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
