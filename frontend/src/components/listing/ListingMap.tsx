"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicListingItem } from "@/types/listing";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createListingPopup } from "./map-popup";
import { listingDisplayTitle } from "@/lib/listing-links";
import "leaflet/dist/leaflet.css";

interface ListingMapProps {
  rooms: PublicListingItem[];
  selectedRoomId?: string | null;
  onSelectRoom?: (id: string) => void;
  centerCoordinates?: { lat: number; lng: number } | null;
  radiusMeters?: number;
}

type MapLayerMode = "hybrid" | "street";

const TILE_SOURCES: Record<MapLayerMode, { url: string; subdomains?: string[]; attribution: string; maxZoom: number }> = {
  hybrid: {
    url: "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=vi",
    subdomains: ["0", "1", "2", "3"],
    attribution: "&copy; Google Satellite &amp; Map Data",
    maxZoom: 20,
  },
  street: {
    url: "https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=vi",
    subdomains: ["0", "1", "2", "3"],
    attribution: "&copy; Google Map Data",
    maxZoom: 20,
  },
};

const ESRI_FALLBACK_SOURCE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
  maxZoom: 19,
};

function formatPriceShort(price: number): string {
  if (price >= 1_000_000) {
    const millions = price / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)} tr`;
  }
  return `${Math.round(price / 1_000)}k`;
}

function updateSelection(markers: Map<string, import("leaflet").Marker>, selectedId?: string | null) {
  markers.forEach((marker, id) => {
    const selected = id === selectedId;
    marker.setZIndexOffset(selected ? 1000 : 0);
    const pin = marker.getElement()?.querySelector<HTMLButtonElement>(".map-price-pin");
    if (pin) {
      pin.classList.toggle("selected", selected);
      pin.style.background = selected ? "#0a1b2a" : "#ffffff";
      pin.style.color = selected ? "#ffffff" : "#0e1620";
      pin.style.borderColor = selected ? "#eef2f6" : "#0a1b2a";
      pin.style.transform = selected ? "scale(1.12)" : "scale(1)";
      pin.setAttribute("aria-pressed", String(selected));
    }
    if (selected) marker.openPopup();
    else marker.closePopup();
  });
}

export default function ListingMap({
  rooms,
  selectedRoomId,
  onSelectRoom,
  centerCoordinates,
  radiusMeters,
}: ListingMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
  const markersLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const circleLayerRef = useRef<import("leaflet").Circle | null>(null);
  const centerMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const initialCenterRef = useRef(centerCoordinates);
  const roomMarkersRef = useRef(new Map<string, import("leaflet").Marker>());
  const selectionRef = useRef({ selectedRoomId, onSelectRoom });
  const fitViewportRef = useRef<(() => void) | null>(null);
  const tilesLayerRef = useRef<import("leaflet").TileLayer | null>(null);
  const failedTilesRef = useRef(new Set<HTMLElement>());
  const loadedAnyTileRef = useRef(false);
  const fallbackUsedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [layerMode, setLayerMode] = useState<MapLayerMode>("hybrid");

  useEffect(() => {
    selectionRef.current = { selectedRoomId, onSelectRoom };
    updateSelection(roomMarkersRef.current, selectedRoomId);
  }, [selectedRoomId, onSelectRoom]);

  useEffect(() => {
    let isMounted = true;
    const container = mapContainerRef.current;
    if (!container) return;
    const roomMarkers = roomMarkersRef.current;
    const failedTiles = failedTilesRef.current;
    let resizeFrame = 0;
    let wasHidden = true;
    let importing = false;

    const initMap = async () => {
      if (
        importing ||
        mapInstanceRef.current ||
        (container as { _leaflet_id?: number })._leaflet_id ||
        !container.clientWidth ||
        !container.clientHeight
      ) {
        return;
      }
      importing = true;

      try {
        const L = await import("leaflet");

        if (
          !isMounted ||
          mapInstanceRef.current ||
          (container as { _leaflet_id?: number })._leaflet_id ||
          !container.clientWidth ||
          !container.clientHeight
        ) {
          return;
        }

        const initialCenter = initialCenterRef.current;
        const initialLat = initialCenter?.lat ?? 10.7725;
        const initialLng = initialCenter?.lng ?? 106.6578;
        const initialZoom = initialCenter ? 15 : 13;

        const map = L.map(container, {
          center: [initialLat, initialLng],
          zoom: initialZoom,
          zoomControl: true,
          scrollWheelZoom: true,
          maxZoom: 20,
        });

        const src = TILE_SOURCES.hybrid;
        const tiles = L.tileLayer(src.url, {
          subdomains: src.subdomains ?? ["0", "1", "2", "3"],
          attribution: src.attribution,
          maxZoom: src.maxZoom,
        });
        tilesLayerRef.current = tiles;

        tiles.on("tileload", () => {
          if (!isMounted) return;
          loadedAnyTileRef.current = true;
          failedTiles.clear();
          setTileError(false);
        });

        tiles.on("tileerror", (event: import("leaflet").TileErrorEvent) => {
          if (!isMounted) return;
          failedTiles.add(event.tile);
          if (!loadedAnyTileRef.current && failedTiles.size >= 4 && !fallbackUsedRef.current) {
            fallbackUsedRef.current = true;
            failedTiles.clear();
            tiles.setUrl(ESRI_FALLBACK_SOURCE.url);
            return;
          }
          if (!loadedAnyTileRef.current && failedTiles.size >= 8) {
            setTileError(true);
          }
        });

        tiles.addTo(map);

        const markersGroup = L.layerGroup().addTo(map);
        markersLayerRef.current = markersGroup;
        mapInstanceRef.current = map;

        setMapReady(true);
      } finally {
        importing = false;
      }
    };

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!isMounted) return;
        const hidden = !container.clientWidth || !container.clientHeight;
        const map = mapInstanceRef.current;
        if (!hidden) {
          if (map) {
            map.invalidateSize({ animate: false, debounceMoveend: true });
            if (wasHidden) fitViewportRef.current?.();
          } else void initMap();
        }
        wasHidden = hidden;
      });
    });
    observer.observe(container);
    void initMap();

    return () => {
      isMounted = false;
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      fitViewportRef.current = null;
      roomMarkers.clear();
      tilesLayerRef.current = null;
      failedTiles.clear();
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerRef.current = null;
        circleLayerRef.current = null;
        centerMarkerRef.current = null;
      }
    };
  }, []);

  // Switch between Satellite Hybrid and Street map layer
  useEffect(() => {
    const tiles = tilesLayerRef.current;
    if (!tiles || !mapReady) return;
    const src = TILE_SOURCES[layerMode];
    fallbackUsedRef.current = false;
    failedTilesRef.current.clear();
    setTileError(false);
    tiles.setUrl(src.url);
  }, [layerMode, mapReady]);

  // Update markers, circle and bounds when rooms or coordinates change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersLayerRef.current;
    if (!map || !markersGroup || !mapReady) return;

    let cancelled = false;

    void (async () => {
      const L = await import("leaflet");
      if (cancelled) return;

      markersGroup.clearLayers();
      roomMarkersRef.current.clear();

      if (circleLayerRef.current) {
        circleLayerRef.current.remove();
        circleLayerRef.current = null;
      }
      if (centerMarkerRef.current) {
        centerMarkerRef.current.remove();
        centerMarkerRef.current = null;
      }

      // Add radius circle if center and radius exist
      if (centerCoordinates && radiusMeters && radiusMeters > 0) {
        const circle = L.circle([centerCoordinates.lat, centerCoordinates.lng], {
          radius: radiusMeters,
          color: "#38bdf8",
          fillColor: "#0284c7",
          fillOpacity: 0.14,
          weight: 2,
          interactive: false,
        }).addTo(map);
        circleLayerRef.current = circle;

        const centerIcon = L.divIcon({
          className: "leaflet-center-pin",
          html: '<div style="width: 16px; height: 16px; background: #0284c7; border: 2.5px solid #ffffff; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.45);"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });
        const centerMarker = L.marker([centerCoordinates.lat, centerCoordinates.lng], {
          icon: centerIcon,
          title: "Tâm tìm kiếm",
        }).addTo(map);
        centerMarkerRef.current = centerMarker;
      }

      const validRooms = rooms.filter(
        (r) =>
          typeof r.latitude === "number" &&
          !isNaN(r.latitude) &&
          typeof r.longitude === "number" &&
          !isNaN(r.longitude)
      );

      const latLngs: [number, number][] = [];
      const seenCoords = new Map<string, number>();

      validRooms.forEach((room) => {
        const key = `${room.latitude.toFixed(5)}:${room.longitude.toFixed(5)}`;
        const duplicateIndex = seenCoords.get(key) ?? 0;
        seenCoords.set(key, duplicateIndex + 1);

        // Slightly fan out markers that share identical coordinates so all pins remain visible on the satellite view
        let lat = room.latitude;
        let lng = room.longitude;
        if (duplicateIndex > 0) {
          const angle = (duplicateIndex * 2 * Math.PI) / 6;
          const radius = 0.00022 * Math.ceil(duplicateIndex / 6);
          lat += radius * Math.cos(angle);
          lng += radius * Math.sin(angle);
        }

        latLngs.push([lat, lng]);

        const priceLabel = formatPriceShort(room.monthlyPrice);
        const pinHtml = `
          <button type="button" class="map-price-pin" aria-pressed="false" style="
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 4px 10px;
            background: #ffffff;
            color: #0e1620;
            border: 1.5px solid #0a1b2a;
            border-radius: 9999px;
            font-size: 12.5px;
            font-weight: 700;
            font-family: var(--sans);
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
            box-shadow: 0 3px 10px rgba(0,0,0,0.38);
            cursor: pointer;
            transition: transform 0.2s ease, background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
          ">
            ${priceLabel}
          </button>
        `;

        const icon = L.divIcon({
          className: "listing-map-pin",
          html: pinHtml,
          iconSize: [60, 28],
          iconAnchor: [30, 14],
        });
        const marker = L.marker([lat, lng], { icon, keyboard: false }).addTo(markersGroup);
        marker.getElement()?.querySelector("button")?.setAttribute("aria-label", `${listingDisplayTitle(room.title)} — ${priceLabel}`);

        const popupContent = createListingPopup(room);
        marker.bindPopup(popupContent, { minWidth: 210, maxWidth: 240, autoPan: false });
        roomMarkersRef.current.set(room.id, marker);

        marker.on("click", () => {
          selectionRef.current.onSelectRoom?.(room.id);
          // Zoom in closer to the house on satellite map when user clicks a pin
          const targetZoom = Math.max(map.getZoom(), 18);
          map.flyTo([lat, lng], targetZoom, { duration: 0.55 });
        });
      });

      fitViewportRef.current = () => {
        if (!map.getContainer().clientWidth || !map.getContainer().clientHeight) return;
        if (latLngs.length > 0) {
          if (centerCoordinates && radiusMeters) {
            const bounds = L.latLngBounds(latLngs);
            bounds.extend([centerCoordinates.lat, centerCoordinates.lng]);
            map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
          } else if (latLngs.length === 1) {
            map.setView(latLngs[0], 17);
          } else {
            const bounds = L.latLngBounds(latLngs);
            map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 });
          }
        } else if (centerCoordinates) {
          map.setView([centerCoordinates.lat, centerCoordinates.lng], 15);
        }
      };
      fitViewportRef.current();
      updateSelection(roomMarkersRef.current, selectionRef.current.selectedRoomId);
    })();

    return () => {
      cancelled = true;
      fitViewportRef.current = null;
    };
  }, [rooms, centerCoordinates, radiusMeters, mapReady]);

  function retryTiles() {
    failedTilesRef.current.clear();
    loadedAnyTileRef.current = false;
    fallbackUsedRef.current = false;
    setTileError(false);
    tilesLayerRef.current?.redraw();
  }

  return (
    <div className="relative isolate flex flex-col w-full h-full min-h-[320px] bg-[#0a1b2a] border border-gray-200 rounded-[4px] overflow-hidden">
      {!mapReady && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#0a1b2a] text-[#eef2f6] text-[13px] font-mono uppercase tracking-wider">
          Đang tải bản đồ vệ tinh…
        </div>
      )}
      {tileError && (
        <div className="shrink-0 bg-white p-3 space-y-2 border-b border-gray-200 z-20">
          <Alert className="text-pretty">Không tải được nền bản đồ. Bạn vẫn có thể xem thông tin phòng trong danh sách.</Alert>
          <Button type="button" variant="secondary" onClick={retryTiles}>Thử tải lại bản đồ</Button>
        </div>
      )}
      {/* Map Mode Switcher: Vệ tinh (Chi tiết nhà) vs Đường phố */}
      <div
        className="absolute top-3 right-3 z-[450] inline-flex rounded-[3px] bg-white/95 backdrop-blur-xs p-0.5 shadow-md border border-gray-200"
        role="group"
        aria-label="Chế độ hiển thị bản đồ"
      >
        <button
          type="button"
          onClick={() => setLayerMode("hybrid")}
          aria-pressed={layerMode === "hybrid"}
          className={`px-2.5 py-1 text-[11.5px] font-semibold rounded-[2px] transition-colors cursor-pointer ${
            layerMode === "hybrid"
              ? "bg-[#0a1b2a] text-white"
              : "text-ink hover:bg-brand-tint"
          }`}
        >
          Vệ tinh
        </button>
        <button
          type="button"
          onClick={() => setLayerMode("street")}
          aria-pressed={layerMode === "street"}
          className={`px-2.5 py-1 text-[11.5px] font-semibold rounded-[2px] transition-colors cursor-pointer ${
            layerMode === "street"
              ? "bg-[#0a1b2a] text-white"
              : "text-ink hover:bg-brand-tint"
          }`}
        >
          Đường phố
        </button>
      </div>
      <div ref={mapContainerRef} className="w-full flex-1 min-h-[320px]" />
    </div>
  );
}
