"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isVietnamLocation, lookupListingLocation, roundedLocation, type LocationPoint, type LocationSelection } from "@/lib/listing-location";
import "leaflet/dist/leaflet.css";

// Viewport limits only; coordinate acceptance still uses the existing polygon guard.
const vietnamViewBounds: import("leaflet").LatLngBoundsExpression = [[8.4, 102.1], [23.4, 109.5]];
const vietnamPanBounds: import("leaflet").LatLngBoundsExpression = [[6.4, 100.1], [25.4, 111.5]];
function overviewZoom(map: import("leaflet").Map) {
  const padding = map.getSize(); // Leaflet returns a cloned Point, safe to use without a server-side import.
  padding.x = 32; padding.y = 32;
  return map.getBoundsZoom(vietnamViewBounds, false, padding);
}
function fitOverview(map: import("leaflet").Map) {
  map.setMinZoom(overviewZoom(map));
  map.fitBounds(vietnamViewBounds, { animate: false, padding: [16, 16] });
}

type Props = {
  provinceCode: string; wardCode: string; provinceName: string; wardName: string;
  initialAddress: string; selection: LocationSelection; onChange: (value: LocationSelection) => void;
  addressError?: string; locationError?: string; active: boolean; disabled: boolean;
};

export function ListingLocationPicker(props: Props) {
  const { provinceCode, wardCode, provinceName, wardName, selection, onChange, disabled } = props;
  const [address, setAddress] = useState(props.initialAddress);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [lookupUnavailable, setLookupUnavailable] = useState(false);
  const [locating, setLocating] = useState(false);
  const [tileError, setTileError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const tilesRef = useRef<import("leaflet").TileLayer | null>(null);
  const current = useRef(selection);
  const changeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const provinceRef = useRef(provinceCode);
  const wardPoint = useRef<LocationPoint | null>(null);
  const previousWard = useRef(`${provinceCode}:${wardCode}`);
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const programmatic = useRef(false);
  const movement = useRef(false);
  const inFlightKey = useRef("");
  const lastBlurKey = useRef("");
  useEffect(() => { current.current = selection; changeRef.current = onChange; disabledRef.current = disabled; provinceRef.current = provinceCode; }, [selection, onChange, disabled, provinceCode]);

  const update = useCallback((patch: Partial<LocationSelection>) => {
    current.current = { ...current.current, ...patch }; changeRef.current(current.current);
  }, []);
  const invalidate = useCallback(() => {
    generation.current++; requestRef.current?.abort(); inFlightKey.current = "";
    setSearching(false); setLocating(false); update({ confirmed: false });
  }, [update]);
  const moveTo = useCallback((point: LocationPoint, zoom: number) => {
    const map = mapRef.current;
    map?.stop();
    const alreadyThere = map && map.getCenter().equals([point.latitude, point.longitude], 0.0000001) && map.getZoom() === zoom;
    update({ point: roundedLocation(point.latitude, point.longitude), confirmed: false, moving: Boolean(map && !alreadyThere) });
    if (alreadyThere) { programmatic.current = false; return; }
    programmatic.current = true;
    if (map) map.flyTo([point.latitude, point.longitude], zoom, { duration: 0.45, animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches });
    else { programmatic.current = false; update({ moving: false }); }
  }, [update]);

  const search = useCallback(async (kind: "province" | "ward" | "address", fromBlur = false) => {
    if (disabled || !provinceCode || !provinceName || (kind !== "province" && (!wardCode || !wardName)) || (kind === "address" && !address.trim())) return;
    if (lookupUnavailable) { setMessage("Chưa kết nối dịch vụ tìm địa chỉ. Hãy kéo bản đồ hoặc dùng vị trí hiện tại."); return; }
    const lookupAddress = kind === "address" ? address.trim() : "";
    const key = `${provinceCode}:${wardCode}:${lookupAddress}`;
    if (inFlightKey.current === key || (fromBlur && lastBlurKey.current === key)) return;
    if (fromBlur) lastBlurKey.current = key;
    invalidate(); const ticket = generation.current;
    const controller = new AbortController(); requestRef.current = controller; inFlightKey.current = key;
    setSearching(true); setMessage("Đang tìm vị trí…");
    try {
      const result = await lookupListingLocation({ provinceCode, wardCode: kind === "province" ? "" : wardCode, provinceName, wardName: kind === "province" ? "" : wardName, addressDetail: lookupAddress }, controller.signal);
      if (!mounted.current || ticket !== generation.current) return;
      if (result.point) {
        if (kind === "ward") wardPoint.current = result.point;
        // Province zoom needs verified bounds; a bare point cannot describe its extent.
        if (kind === "province") { setMessage("Chưa có ranh giới tỉnh/thành phố đã kiểm chứng. Hãy kéo bản đồ tới khu vực phòng."); return; }
        moveTo(result.point, kind === "ward" ? 15 : 18);
        setMessage(kind === "ward" ? "Đã chuyển tới khu vực phường/xã. Kéo bản đồ tới đúng phòng rồi xác nhận." : "Đã tìm thấy địa chỉ. Kiểm tra ghim rồi xác nhận vị trí.");
      } else {
        if (wardPoint.current) moveTo(wardPoint.current, 14);
        setMessage("Không tìm thấy chính xác, hãy kéo bản đồ tới đúng vị trí");
      }
    } catch (error) {
      if (mounted.current && ticket === generation.current && !controller.signal.aborted) {
        if (error instanceof Error && error.cause === "GEOCODING_NOT_CONFIGURED") setLookupUnavailable(true);
        setMessage(error instanceof Error ? error.message : "Không thể tìm địa chỉ. Hãy kéo bản đồ thủ công.");
      }
    } finally {
      if (mounted.current && ticket === generation.current) { setSearching(false); inFlightKey.current = ""; requestRef.current = null; }
    }
  }, [disabled, provinceCode, wardCode, provinceName, wardName, address, invalidate, moveTo, lookupUnavailable]);

  useEffect(() => {
    const key = `${provinceCode}:${wardCode}`;
    if (previousWard.current === key) return;
    previousWard.current = key; wardPoint.current = null; lastBlurKey.current = "";
    invalidate(); mapRef.current?.stop(); programmatic.current = true;
    if (mapRef.current) fitOverview(mapRef.current);
    programmatic.current = false; update({ point: null, moving: false }); setMessage("");
    if (provinceCode) void search(wardCode ? "ward" : "province");
  }, [provinceCode, wardCode, invalidate, search, update]);

  useEffect(() => {
    mounted.current = true;
    const element = container.current;
    const revision = generation;
    if (!element) return;
    let cancelled = false; let frame = 0; let importing = false; let resizing = false;
    const failedTiles = new Set<HTMLElement>();
    async function init() {
      if (!element || cancelled || importing || mapRef.current || !element.clientWidth || !element.clientHeight) return;
      importing = true;
      try {
        const L = await import("leaflet");
        if (cancelled || !element.clientWidth || !element.clientHeight) return;
        const point = provinceRef.current ? current.current.point : null;
        // Exact pin selection: no inertial glide after the user releases a drag.
        const map = L.map(element, { center: point ? [point.latitude, point.longitude] : [15.8, 106.5], zoom: point ? 17 : 5, inertia: false,
          // Leaflet's CSS zoom completion can overwrite a newer address flyTo; keep pinch/wheel commits synchronous.
          zoomControl: false, zoomAnimation: false, keyboard: false, scrollWheelZoom: false, touchZoom: "center", maxZoom: 19,
          zoomSnap: 0.25, maxBounds: vietnamPanBounds, maxBoundsViscosity: 1 });
        map.setMinZoom(overviewZoom(map));
        if (!point) fitOverview(map);
        mapRef.current = map;
        // Reuse the project's OSM basemap, not a geocoder. Attribution stays visible.
        const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors' });
        tilesRef.current = tiles;
        tiles.on("tileerror", (event: import("leaflet").TileErrorEvent) => { if (!cancelled) { failedTiles.add(event.tile); setTileError(true); } });
        const loaded = (event: import("leaflet").TileEvent) => { if (!cancelled) { failedTiles.delete(event.tile); setTileError(failedTiles.size > 0); } };
        tiles.on("tileload", loaded); tiles.on("tileunload", loaded); tiles.addTo(map);
        map.on("click", (event: import("leaflet").LeafletMouseEvent) => {
          if (cancelled || disabledRef.current) return;
          if (!provinceRef.current) { setMessage("Chọn tỉnh/thành phố trước khi đặt ghim trên bản đồ."); return; }
          // Cancel pending lookup/GPS so a late result cannot replace this manual choice.
          map.stop(); programmatic.current = false; invalidate();
          const point = roundedLocation(event.latlng.lat, event.latlng.lng);
          if (!isVietnamLocation(point)) {
            setMessage("Vị trí chọn nằm ngoài khu vực Việt Nam được hỗ trợ. Hãy chọn lại trên bản đồ."); return;
          }
          // Keep the pin fixed at the centre, as for drag/keyboard selection.
          // No animation: a tap must not still be flying when the user starts dragging.
          map.panTo([point.latitude, point.longitude], { animate: false });
          const center = map.getCenter();
          update({ point: roundedLocation(center.lat, center.lng), moving: false, confirmed: false });
          setMessage("Đã đặt ghim tại vị trí bạn chọn. Kéo bản đồ để chỉnh, rồi xác nhận vị trí.");
        });
        map.on("dragstart", () => { if (!cancelled && !disabledRef.current) { programmatic.current = false; invalidate(); } });
        map.on("movestart", () => { if (!cancelled && !resizing && !disabledRef.current && provinceRef.current) { movement.current = true; if (!programmatic.current) invalidate(); update({ moving: true, confirmed: false }); } });
        map.on("moveend", () => {
          if (cancelled || resizing || disabledRef.current || !movement.current) return;
          movement.current = false;
          const automatic = programmatic.current; programmatic.current = false;
          if (!provinceRef.current) return;
          const center = map.getCenter(); const point = roundedLocation(center.lat, center.lng);
          update({ point, moving: false, confirmed: false });
          if (!automatic) setMessage(isVietnamLocation(point) ? "Ghim đã thay đổi. Xác nhận lại vị trí trước khi tiếp tục." : "Ghim nằm ngoài khu vực Việt Nam được hỗ trợ. Hãy kéo lại vị trí.");
        });
        if (disabledRef.current) { map.dragging.disable(); map.touchZoom.disable(); map.doubleClickZoom.disable(); map.boxZoom.disable(); }
        setReady(true);
      } catch { if (!cancelled) setMessage("Không tải được bản đồ. Vui lòng tải lại trang."); }
      finally { importing = false; }
    }
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        if (cancelled || !element.clientWidth || !element.clientHeight) return;
        if (mapRef.current) {
          // Layout changes must not change the saved pin or invalidate its confirmation.
          resizing = true;
          try {
            mapRef.current.invalidateSize({ animate: false, pan: false });
            mapRef.current.setMinZoom(overviewZoom(mapRef.current));
            if (!current.current.point) fitOverview(mapRef.current);
          } finally { resizing = false; }
        } else void init();
      });
    });
    resize.observe(element); void init();
    return () => { cancelled = true; mounted.current = false; revision.current++; requestRef.current?.abort(); resize.disconnect(); cancelAnimationFrame(frame); mapRef.current?.remove(); mapRef.current = null; tilesRef.current = null; };
  }, [invalidate, update]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    for (const control of [map.dragging, map.touchZoom, map.doubleClickZoom, map.boxZoom]) { if (disabled) control.disable(); else control.enable(); }
    if (!disabled && container.current === document.activeElement) map.scrollWheelZoom.enable(); else map.scrollWheelZoom.disable();
    if (props.active) map.invalidateSize({ animate: false, pan: false });
  }, [disabled, props.active, ready]);

  function manualMove(action: (map: import("leaflet").Map) => void) {
    const map = mapRef.current; if (disabled || !ready || !map) return;
    map.stop(); programmatic.current = false; invalidate(); action(map);
  }
  function pan(x: number, y: number) { manualMove(map => map.panBy([x, y], { animate: false })); }
  function locate() {
    if (disabled || locating || !provinceCode) return;
    invalidate(); const ticket = generation.current;
    if (!navigator.geolocation) { setMessage("Trình duyệt không hỗ trợ định vị. Hãy kéo bản đồ thủ công."); return; }
    setLocating(true); setMessage("Đang lấy vị trí hiện tại…");
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current || ticket !== generation.current) return;
      setLocating(false);
      const point = roundedLocation(position.coords.latitude, position.coords.longitude);
      if (!isVietnamLocation(point)) { setMessage("Vị trí hiện tại nằm ngoài khu vực Việt Nam được hỗ trợ. Hãy kéo bản đồ thủ công."); return; }
      moveTo(point, 18); setMessage("Đã dùng vị trí hiện tại. Kiểm tra ghim đúng phòng rồi xác nhận.");
    }, error => {
      if (!mounted.current || ticket !== generation.current) return;
      setLocating(false); setMessage(error.code === 1 ? "Bạn đã từ chối quyền vị trí. Có thể cấp lại trong trình duyệt hoặc kéo bản đồ thủ công."
        : error.code === 3 ? "Lấy vị trí quá lâu. Thử lại hoặc kéo bản đồ thủ công." : "Không lấy được vị trí hiện tại. Thử lại hoặc kéo bản đồ thủ công.");
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
  }
  const canConfirm = ready && Boolean(provinceCode && wardCode && address.trim()) && isVietnamLocation(selection.point) && !selection.moving && !searching && !locating && !disabled;
  return <div className="min-w-0 space-y-4">
    <Input name="addressDetail" label="Số nhà và tên đường" required maxLength={255} value={address} error={props.addressError}
      hint="Chỉ nhập số nhà và tên đường; tỉnh/thành phố và phường/xã chọn ở trên."
      onChange={event => { setAddress(event.target.value); lastBlurKey.current = ""; invalidate(); setMessage("Địa chỉ đã thay đổi. Tìm lại hoặc kiểm tra ghim và xác nhận lại."); }} onBlur={() => void search("address", true)} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Button type="button" variant="secondary" disabled={lookupUnavailable || !provinceCode || !wardCode || !address.trim() || !ready || disabled} aria-busy={searching} aria-disabled={searching} onClick={() => { if (!searching) void search("address"); }}>Tìm trên bản đồ</Button>
      <Button type="button" variant="secondary" disabled={!provinceCode || !ready || disabled} aria-busy={locating} aria-disabled={locating} onClick={locate}>Dùng vị trí hiện tại</Button>
    </div>
    <div className="space-y-2">
      <p id="listing-map-instructions" className="text-sm font-medium">Kéo bản đồ để ghim đúng vị trí phòng</p>
      <p id="listing-map-keyboard" className="text-pretty text-sm text-muted">Nhấp hoặc chạm vào vị trí phòng để đặt ghim; kéo bản đồ để chỉnh. Cuộn chuột hoặc dùng hai ngón để thu/phóng.<span className="sr-only"> Ghim cố định ở giữa. Có thể Tab tới bản đồ và dùng phím mũi tên để nhích vị trí.</span></p>
      <div className="relative isolate h-80 overflow-hidden rounded-xl border border-line bg-background sm:h-96">
        <div ref={container} role="region" aria-label="Bản đồ chọn vị trí phòng" aria-describedby="listing-map-instructions listing-map-keyboard listing-location-status" tabIndex={disabled ? -1 : 0}
          className="h-full w-full" onPointerDown={event => { if (!disabled && !(event.target as Element).closest("a, button")) event.currentTarget.focus({ preventScroll: true }); }}
          onFocus={() => { if (!disabled) mapRef.current?.scrollWheelZoom.enable(); }} onBlur={() => mapRef.current?.scrollWheelZoom.disable()}
          onKeyDown={event => { if (event.target !== event.currentTarget) return; const directions: Record<string, [number, number]> = { ArrowUp: [0, -40], ArrowDown: [0, 40], ArrowLeft: [-40, 0], ArrowRight: [40, 0] }; const offset = directions[event.key]; if (offset) { event.preventDefault(); pan(...offset); } }} />
        {provinceCode && selection.point ? <div className="pointer-events-none absolute inset-0 z-[450] grid place-items-center" aria-hidden="true"><div className="flex h-0 w-0 items-end justify-center"><MapPin className="h-10 w-10 shrink-0 text-brand" fill="var(--soft-green)" strokeWidth={2.5} /></div></div> : null}
        {!ready ? <p role="status" className="pointer-events-none absolute inset-0 z-[451] grid place-items-center bg-background">Đang tải bản đồ…</p> : null}
        <div className="absolute right-3 top-3 z-[450] flex flex-col gap-2" aria-label="Thu phóng bản đồ">
          <Button type="button" variant="secondary" className="w-11 px-0" aria-label="Phóng to bản đồ" disabled={!ready || disabled} onClick={() => manualMove(map => map.zoomIn())}><Plus className="size-4" aria-hidden="true" /></Button>
          <Button type="button" variant="secondary" className="w-11 px-0" aria-label="Thu nhỏ bản đồ" disabled={!ready || disabled} onClick={() => manualMove(map => map.zoomOut())}><Minus className="size-4" aria-hidden="true" /></Button>
        </div>
      </div>
      {tileError ? <div role="alert" className="space-y-2 text-sm"><p>Không tải được nền bản đồ. Chưa nên xác nhận nếu không nhìn rõ vị trí phòng.</p><Button type="button" variant="secondary" disabled={disabled} onClick={() => tilesRef.current?.redraw()}>Tải lại nền bản đồ</Button></div> : null}
    </div>
    <p id="listing-location-status" role="status" aria-live="polite" className="min-h-10 text-sm text-muted">{message || (!wardCode ? "Chọn tỉnh/thành phố và phường/xã trước khi xác nhận vị trí." : "Nhấp vào vị trí phòng hoặc kéo bản đồ để đặt ghim, rồi xác nhận.")}</p>
    <input type="hidden" name="latitude" value={selection.point?.latitude.toFixed(6) ?? ""} />
    <input type="hidden" name="longitude" value={selection.point?.longitude.toFixed(6) ?? ""} />
    <Button id="listing-location-confirm" type="button" variant="secondary" className="w-full sm:w-auto" disabled={!canConfirm || tileError} aria-disabled={selection.confirmed} onClick={() => {
      if (!canConfirm || selection.confirmed) return;
      update({ confirmed: true }); setMessage("Đã xác nhận vị trí. Có thể tiếp tục; đổi địa chỉ hoặc di chuyển bản đồ sẽ cần xác nhận lại.");
    }}>{selection.confirmed ? "Đã xác nhận vị trí" : "Xác nhận vị trí"}</Button>
    {props.locationError ? <p role="alert" className="field-error">{props.locationError}</p> : null}
    <span className="sr-only" aria-live="polite" aria-atomic="true">{provinceCode && selection.point ? `Ghim tại vĩ độ ${selection.point.latitude.toFixed(6)}, kinh độ ${selection.point.longitude.toFixed(6)}.` : "Chưa đặt ghim vị trí phòng."}</span>
  </div>;
}
