// Existing demo controls only; these bounds are not booking policy.
export function readHomestayPreviewFilters(params: URLSearchParams, defaults: { checkIn: string; checkOut: string }) {
  const date = (value: string | null, fallback: string) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : fallback;
  };
  const count = Number(params.get("guests")) || 2;
  return {
    destination: params.get("dest") ?? "TP. Hồ Chí Minh",
    checkIn: date(params.get("checkIn"), defaults.checkIn),
    checkOut: date(params.get("checkOut"), defaults.checkOut),
    adults: String(Number.isInteger(count) ? Math.min(4, Math.max(1, count)) : 2),
  };
}
