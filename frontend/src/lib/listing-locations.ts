// Existing UI presets only; not the verified national POI catalog required by Sprint 2.
export const PRESET_LOCATIONS = [
  { id: "all", name: "Tất cả địa điểm", lat: undefined, lng: undefined },
  { id: "bk", name: "ĐH Bách Khoa TP.HCM (Quận 10)", lat: 10.7725, lng: 106.6578 },
  { id: "q1", name: "Trung tâm Quận 1", lat: 10.7769, lng: 106.7009 },
  { id: "thu_duc", name: "ĐHQG TP.HCM (TP. Thủ Đức)", lat: 10.8700, lng: 106.8031 },
];

export function longTermSearchHref(location: string, maxPrice: string, radiusKm: string): string {
  const query = new URLSearchParams({ location, maxPrice, radius: String(Number(radiusKm) * 1000) });
  return `/thue-phong-tro?${query}`;
}
