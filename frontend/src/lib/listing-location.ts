import boundary from "./vietnam-boundary.json";

export type LocationPoint = { latitude: number; longitude: number };
export type LocationSelection = { point: LocationPoint | null; confirmed: boolean; moving: boolean };

// geoBoundaries VNM-ADM0-46766057, pinned 9469f09; CC BY 4.0.
// https://www.geoboundaries.org/api/current/gbOpen/VNM/ADM0/
// Supplement: Natural Earth 1:10m Con Son polygon (public domain); see boundary attribution.
// A geographic input guard, not a cadastral/sovereignty determination. See the local decision log.
function inRing(x: number, y: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isVietnamLocation(point: LocationPoint | null): point is LocationPoint {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
    || point.latitude < 8.4 || point.latitude > 23.4 || point.longitude < 102.1 || point.longitude > 109.5) return false;
  return boundary.coordinates.some(polygon => inRing(point.longitude, point.latitude, polygon[0])
    && !polygon.slice(1).some(hole => inRing(point.longitude, point.latitude, hole)));
}

export function roundedLocation(latitude: number, longitude: number): LocationPoint {
  return { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) };
}

export function locationCanContinue(selection: LocationSelection) {
  return selection.confirmed && !selection.moving && isVietnamLocation(selection.point);
}

export type LocationLookup = { provinceCode: string; wardCode: string; provinceName: string; wardName: string; addressDetail: string };
export async function lookupListingLocation(address: LocationLookup, signal: AbortSignal): Promise<{ point: LocationPoint | null }> {
  const response = await fetch("/api/listing-location", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(address), signal, cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.errorCode === "GEOCODING_NOT_CONFIGURED"
    ? "Chưa kết nối dịch vụ tìm địa chỉ. Hãy kéo bản đồ hoặc dùng vị trí hiện tại."
    : response.status === 429 ? "Tìm địa chỉ quá nhiều lần. Vui lòng chờ một phút rồi thử lại."
    : "Không thể tìm địa chỉ lúc này. Hãy thử lại hoặc kéo bản đồ thủ công.", { cause: body.errorCode });
  if (body.success !== true || !body.data || !("point" in body.data)) throw new Error("Kết quả tìm địa chỉ không hợp lệ.");
  if (body.data.point === null) return { point: null };
  const point = body.data.point;
  if (!isVietnamLocation(point)) throw new Error("Vị trí tìm được nằm ngoài khu vực Việt Nam được hỗ trợ. Hãy kéo lại ghim.");
  return { point: roundedLocation(point.latitude, point.longitude) };
}
