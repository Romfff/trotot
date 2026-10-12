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
    const pin = marker.getElement()?.querySelector<HTMLButtonElement>(".map-price-pin");
    if (pin) {
      pin.classList.toggle("selected", selected);
      pin.style.background = selected ? "var(--primary)" : "#ffffff";
      pin.style.color = selected ? "#ffffff" : "var(--foreground)";
      pin.style.borderColor = selected ? "var(--primary)" : "var(--line)";
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
  const [mapReady, setMapReady] = useState(false);
  const [tileError, setTileError] = useState(false);

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

    const initMap = async () => {
      // A CSS-hidden mobile map has no usable size. Initialize on first reveal.
      if (mapInstanceRef.current || !container.clientWidth || !container.clientHeight) return;

      const L = await import("leaflet");

      if (!isMounted || mapInstanceRef.current || !container.clientWidth || !container.clientHeight) return;

      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const initialCenter = initialCenterRef.current;
      const initialLat = initialCenter?.lat ?? 10.7725;
      const initialLng = initialCenter?.lng ?? 106.6578;
      const initialZoom = initialCenter ? 13 : 12;

      const map = L.map(container, {
        center: [initialLat, initialLng],
        zoom: initialZoom,
        zoomControl: true,
        scrollWheelZoom: true,
      });

      // Standard OSM tiles: preserve browser caching/Referer and visible attribution.
      // Public service has no SLA; select a supported provider before high-traffic launch.
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        maxZoom: 19,
      });
      tilesLayerRef.current = tiles;
      tiles.on("tileerror", (event: import("leaflet").TileErrorEvent) => {
        if (!isMounted) return;
        failedTiles.add(event.tile);
        setTileError(true);
      });
      const clearTileFailure = (event: import("leaflet").TileEvent) => {
        if (!isMounted) return;
        failedTiles.delete(event.tile);
        setTileError(failedTiles.size > 0);
      };
      tiles.on("tileload", clearTileFailure);
      tiles.on("tileunload", clearTileFailure);
      tiles.addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerRef.current = markersGroup;
      mapInstanceRef.current = map;

      setMapReady(true);
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
          color: "#1f8a70",
          fillColor: "#1f8a70",
          fillOpacity: 0.08,
          weight: 1.5,
          interactive: false,
        }).addTo(map);
        circleLayerRef.current = circle;

        const centerIcon = L.divIcon({
          className: "leaflet-center-pin",
          html: '<div style="width: 14px; height: 14px; background: #18725c; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 1px 4px rgba(16,48,43,0.3);"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
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

      validRooms.forEach((room) => {
        latLngs.push([room.latitude, room.longitude]);

        const priceLabel = formatPriceShort(room.monthlyPrice);
        const pinHtml = `
          <button type="button" class="map-price-pin" aria-pressed="false" style="
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 3px 9px;
            background: #ffffff;
            color: var(--foreground);
            border: 1px solid var(--line);
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 700;
            font-family: inherit;
            white-space: nowrap;
            box-shadow: 0 1px 3px rgba(16,48,43,0.12);
            cursor: pointer;
            transition: background-color 0.15s, color 0.15s, border-color 0.15s;
          ">
            ${priceLabel}
          </button>
        `;

        const icon = L.divIcon({
          className: "listing-map-pin",
          html: pinHtml,
          iconSize: [56, 26],
          iconAnchor: [28, 13],
        });
        // The inner native button is the keyboard target; Leaflet must not add a second one around it.
        const marker = L.marker([room.latitude, room.longitude], { icon, keyboard: false }).addTo(markersGroup);
        marker.getElement()?.querySelector("button")?.setAttribute("aria-label", `${listingDisplayTitle(room.title)} — ${priceLabel}`);

        const popupContent = createListingPopup(room);

        // Card hover highlights a pin without panning or zooming the user's map.
        marker.bindPopup(popupContent, { minWidth: 200, maxWidth: 230, autoPan: false });
        roomMarkersRef.current.set(room.id, marker);

        marker.on("click", () => {
          selectionRef.current.onSelectRoom?.(room.id);
        });

      });

      fitViewportRef.current = () => {
        if (!map.getContainer().clientWidth || !map.getContainer().clientHeight) return;
        if (latLngs.length > 0) {
          if (centerCoordinates && radiusMeters) {
            const bounds = L.latLngBounds(latLngs);
            bounds.extend([centerCoordinates.lat, centerCoordinates.lng]);
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
          } else if (latLngs.length === 1) {
            map.setView(latLngs[0], 14);
          } else {
            const bounds = L.latLngBounds(latLngs);
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
          }
        } else if (centerCoordinates) {
          map.setView([centerCoordinates.lat, centerCoordinates.lng], 13);
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
    setTileError(false);
    // Redraw only the tile layer; keep filters, listing data and the current view.
    tilesLayerRef.current?.redraw();
  }

  return (
    <div className="relative isolate flex flex-col w-full h-full min-h-[320px] bg-[#f2f4f3] border border-gray-200 rounded-[12px] overflow-hidden">
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#f2f4f3] text-gray-600 text-[13px]">
          Đang tải bản đồ…
        </div>
      )}
      {tileError && (
        <div className="shrink-0 bg-white p-3 space-y-2 border-b border-gray-200">
          <Alert className="text-pretty">Không tải được nền bản đồ. Bạn vẫn có thể xem thông tin phòng trong danh sách.</Alert>
          <Button type="button" variant="secondary" onClick={retryTiles}>Thử tải lại bản đồ</Button>
        </div>
      )}
      <div ref={mapContainerRef} className="w-full flex-1 min-h-[320px]" />
    </div>
  );
}
