"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { DEFAULT_CENTER, DEFAULT_ZOOM, type LatLng, type VehicleType } from "@/lib/utils";

export type MapRef = {
  flyTo: (point: LatLng, zoom?: number, duration?: number) => void;
  panTo: (point: LatLng, duration?: number) => void;
};

type MapProps = {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  driver: LatLng | null;
  /** Siluet kendaraan yang dirender (motor biru / mobil navy). */
  vehicleType?: VehicleType;
  /** Arah hadap kendaraan dalam derajat, mengikuti belokan rute OSRM. */
  heading?: number | null;
  onPickPoint?: (point: LatLng) => void;
  /**
   * Road geometry from GET /api/routing as Leaflet-ready [lat, lng] pairs.
   * The map never calls OSRM itself, so routing happens exactly once, server-side.
   */
  route?: [number, number][] | null;
  /** Saat true (PICKING_UP/ON_TRIP), kamera mengikuti GPS driver dengan lembut. */
  followDriver?: boolean;
  /** Mode "Geser Peta": pin target di tengah layar untuk memilih titik. */
  pickMode?: boolean;
  /** Dipanggil saat peta berhenti digeser dalam mode pilih-titik. */
  onPickCenter?: (point: LatLng) => void;
  /** Dipanggil saat peta siap, memberikan akses ke flyTo/panTo. */
  onMapReady?: (ref: MapRef) => void;
};

/**
 * Pin jemput hijau bulat modern dengan gelombang radar berdenyut.
 * Animasi didefinisikan di <style> RODAKU_MAP_CSS agar berlaku di divIcon.
 */
function pickupHtml(): string {
  return `
    <div style="position:relative;width:44px;height:44px;">
      <span style="position:absolute;inset:0;border-radius:9999px;background:#16A34A;opacity:.45;animation:rodaku-radar 1.8s ease-out infinite;"></span>
      <span style="position:absolute;inset:0;border-radius:9999px;background:#16A34A;opacity:.3;animation:rodaku-radar 1.8s ease-out .6s infinite;"></span>
      <span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:9999px;background:#16A34A;border:3px solid #ffffff;box-shadow:0 4px 14px rgba(22,163,74,.55);display:flex;align-items:center;justify-content:center;">
        <span style="width:8px;height:8px;border-radius:9999px;background:#ffffff;"></span>
      </span>
    </div>`;
}

/** Pin tujuan merah dengan ikon garis finish. */
function dropoffHtml(): string {
  return `
    <div style="position:relative;width:44px;height:44px;">
      <span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:9999px;background:#EF4444;border:3px solid #ffffff;box-shadow:0 4px 14px rgba(239,68,68,.55);display:flex;align-items:center;justify-content:center;font-size:14px;line-height:1;">🏁</span>
    </div>`;
}

const pickupIcon = L.divIcon({
  className: "",
  html: pickupHtml(),
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  popupAnchor: [0, -24],
});

const dropoffIcon = L.divIcon({
  className: "",
  html: dropoffHtml(),
  iconSize: [44, 44],
  iconAnchor: [22, 22],
  popupAnchor: [0, -24],
});

const MOTOR_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22"
       fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="5" cy="17" r="2.6"/><circle cx="19" cy="17" r="2.6"/>
    <path d="M5 17l3.5-7H13l3 4"/>
    <path d="M13 10l-1.5-4H15l1.5 4"/>
    <path d="M8.5 10H6"/>
  </svg>`;

const MOBIL_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22"
       fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="6" cy="17" r="2.4"/><circle cx="18" cy="17" r="2.4"/>
    <path d="M3.5 17v-4.5l2-4.5h11l3 4.5H21V17"/>
    <path d="M9 7V5h5v2"/>
  </svg>`;

/**
 * Custom Animated Vehicle Marker: siluet motor Royal Blue untuk RodaMotor,
 * siluet mobil Navy Slate untuk RodaMobil. Rotasi `heading` mengikuti arah
 * belokan rute OSRM dengan transisi CSS 1.2s agar meluncur mulus.
 */
function vehicleIcon(vehicle: VehicleType = "RODA_MOTOR", heading = 0): L.DivIcon {
  const isMotor = vehicle === "RODA_MOTOR";
  const bg = isMotor ? "#1D4ED8" : "#0F172A";
  const shadow = isMotor
    ? "0 8px 20px rgba(29,78,216,0.45)"
    : "0 8px 20px rgba(15,23,42,0.45)";
  const safeHeading = Number.isFinite(heading) ? heading : 0;
  return L.divIcon({
    className: "",
    html: `
      <div style="display:flex;align-items:center;justify-content:center;
                  width:44px;height:44px;border-radius:9999px;
                  background:${bg};border:3px solid #ffffff;
                  box-shadow:${shadow};">
        <div style="display:flex;align-items:center;justify-content:center;
                    transform: rotate(${safeHeading}deg);
                    transition: transform 1.2s ease-out;">
          ${isMotor ? MOTOR_SVG : MOBIL_SVG}
        </div>
      </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
  });
}

/**
 * Eases the driver marker toward each incoming fix instead of snapping, so the
 * vehicle glides between telemetry ticks. All setState happens inside the rAF
 * callback, never synchronously in the effect body.
 */
function useSmoothPoint(target: LatLng | null): LatLng | null {
  const [point, setPoint] = useState<LatLng | null>(null);
  const currentRef = useRef<LatLng | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) {
      currentRef.current = null;
      return;
    }

    const start = currentRef.current;
    if (!start) {
      // First fix: no travel to animate, just adopt it.
      currentRef.current = target;
      return;
    }
    if (start.lat === target.lat && start.lng === target.lng) return;

    const startedAt = performance.now();
    const fromLat = start.lat;
    const fromLng = start.lng;
    const DURATION_MS = 1400;

    const step = (now: number) => {
      const t = Math.min((now - startedAt) / DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);

      const next = {
        lat: fromLat + (target.lat - fromLat) * eased,
        lng: fromLng + (target.lng - fromLng) * eased,
      };
      currentRef.current = next;
      setPoint(next);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return point;
}

function DriverMarker({
  point,
  vehicleType,
  heading,
}: {
  point: LatLng | null;
  vehicleType: VehicleType;
  heading: number | null;
}) {
  const smooth = useSmoothPoint(point);
  const icon = useMemo(
    () => vehicleIcon(vehicleType, heading ?? 0),
    [vehicleType, heading],
  );
  if (!point) return null;

  // Before the first animation frame, sit exactly on the latest fix.
  const render = smooth ?? point;
  return <Marker position={[render.lat, render.lng]} icon={icon} />;
}

function ClickCapture({
  onPickPoint,
}: {
  onPickPoint?: (point: LatLng) => void;
}) {
  useMapEvents({
    click(e) {
      onPickPoint?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/**
 * Menjamin peta tidak pernah abu-abu/putih kosong saat container berubah
 * ukuran atau pengguna berpindah tab: panggil `map.invalidateSize()` pada
 * mount, resize window, perubahan ukuran container, dan saat tab kembali
 * terlihat.
 */
function MapResizer() {
  const map = useMap();

  useEffect(() => {
    const invalidate = () => {
      try {
        map.invalidateSize();
      } catch {
        /* abaikan: peta belum siap */
      }
    };

    const t = setTimeout(invalidate, 150);
    const t2 = setTimeout(invalidate, 500);

    window.addEventListener("resize", invalidate);
    const onVisible = () => {
      if (document.visibilityState === "visible") invalidate();
    };
    document.addEventListener("visibilitychange", onVisible);

    let observer: ResizeObserver | null = null;
    const container = map.getContainer();
    if (typeof ResizeObserver !== "undefined" && container) {
      observer = new ResizeObserver(() => invalidate());
      observer.observe(container);
    }

    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      window.removeEventListener("resize", invalidate);
      document.removeEventListener("visibilitychange", onVisible);
      observer?.disconnect();
    };
  }, [map]);

  return null;
}

/**
 * Kamera cerdas: saat rute dibuat, bingkai seluruh rute agar pas di tengah
 * layar dan tidak tertutup kartu UI; saat follow aktif, geser lembut mengikuti
 * GPS driver tanpa pastor.
 */
function SmartCamera({
  frameKey,
  points,
  driver,
  follow,
}: {
  frameKey: string;
  points: LatLng[];
  driver: LatLng | null;
  follow: boolean;
}) {
  const map = useMap();
  const lastFrame = useRef<string | null>(null);

  // Bingkai rute — hanya sekali per rute baru, dan tidak saat follow aktif.
  useEffect(() => {
    if (follow || points.length === 0) return;
    if (lastFrame.current === frameKey) return;
    lastFrame.current = frameKey;
    if (points.length === 1) {
      map.flyTo([points[0].lat, points[0].lng], 15, { duration: 0.6 });
      return;
    }
    map.fitBounds(
      L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])),
      { padding: [80, 80], maxZoom: 16, animate: true },
    );
  }, [map, frameKey, points, follow]);

  // Ikuti driver dengan geseran lembut 1 detik.
  useEffect(() => {
    if (!follow || !driver) return;
    map.panTo([driver.lat, driver.lng], { animate: true, duration: 1 });
  }, [map, follow, driver]);

  return null;
}

/**
 * Pin target interaktif di tengah layar untuk mode "Geser Peta".
 * Memantul saat peta digeser; saat berhenti, laporkan koordinat tengah.
 */
function CenterPin({
  active,
  onPickCenter,
}: {
  active: boolean;
  onPickCenter?: (point: LatLng) => void;
}) {
  const [moving, setMoving] = useState(false);
  const pickRef = useRef(onPickCenter);

  useEffect(() => {
    pickRef.current = onPickCenter;
  }, [onPickCenter]);

  const map = useMapEvents({
    movestart() {
      if (active) setMoving(true);
    },
    moveend() {
      if (!active) return;
      setMoving(false);
      const center = map.getCenter();
      pickRef.current?.({ lat: center.lat, lng: center.lng });
    },
  });

  if (!active) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        zIndex: 500,
        pointerEvents: "none",
        transform: "translate(-50%, -100%)",
      }}
    >
      <div
        style={{
          fontSize: 38,
          lineHeight: 1,
          filter: "drop-shadow(0 6px 8px rgba(15,23,42,.4))",
          animation: moving ? "rodaku-pin-bounce .55s ease-in-out infinite" : "none",
        }}
      >
        📍
      </div>
      <div
        style={{
          width: 26,
          height: 7,
          margin: "2px auto 0",
          borderRadius: 9999,
          background: "rgba(15,23,42,.3)",
          transform: moving ? "scaleX(.6)" : "scaleX(1)",
          transition: "transform .2s",
        }}
      />
    </div>
  );
}

function MapReadyHandler({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

// Mobile touch handler: prevent browser pinch zoom conflicts while allowing Leaflet gestures
function MobileTouchHandler({ isMobile }: { isMobile: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!isMobile) return;
    const container = map.getContainer();
    if (!container) return;

    // Prevent browser default pinch zoom but allow Leaflet to handle it
    const preventDefault = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };
    container.addEventListener("touchstart", preventDefault, { passive: false });
    container.addEventListener("touchmove", preventDefault, { passive: false });

    return () => {
      container.removeEventListener("touchstart", preventDefault);
      container.removeEventListener("touchmove", preventDefault);
    };
  }, [map, isMobile]);
  return null;
}

const MapComponent = forwardRef<MapRef, MapProps>((props, ref) => {
  const mapInstance = useRef<L.Map | null>(null);
  const {
    pickup,
    dropoff,
    driver,
    vehicleType = "RODA_MOTOR",
    heading = null,
    onPickPoint,
    route,
    followDriver = false,
    pickMode = false,
    onPickCenter,
    onMapReady,
  } = props;

  // Expose flyTo/panTo to parent via ref
  useImperativeHandle(ref, () => ({
    flyTo: (point: LatLng, zoom = 15, duration = 0.8) => {
      mapInstance.current?.flyTo([point.lat, point.lng], zoom, { animate: true, duration });
    },
    panTo: (point: LatLng, duration = 0.6) => {
      mapInstance.current?.panTo([point.lat, point.lng], { animate: true, duration });
    },
  }));

  // Notify parent when map is ready
  useEffect(() => {
    if (mapInstance.current && onMapReady) {
      onMapReady({
        flyTo: (point: LatLng, zoom = 15, duration = 0.8) => {
          mapInstance.current?.flyTo([point.lat, point.lng], zoom, { animate: true, duration });
        },
        panTo: (point: LatLng, duration = 0.6) => {
          mapInstance.current?.panTo([point.lat, point.lng], { animate: true, duration });
        },
      });
    }
  }, [onMapReady]);

  // Prefer the server road route; fall back to a straight line while the
  // routing request is still in flight or if it failed.
  const activeRoute = useMemo<[number, number][]>(() => {
    if (route && route.length >= 2) return route;
    if (!pickup || !dropoff) return [];
    return [
      [pickup.lat, pickup.lng],
      [dropoff.lat, dropoff.lng],
    ];
  }, [pickup, dropoff, route]);

  const focusPoints = useMemo(() => {
    const pts: LatLng[] = [];
    if (pickup) pts.push(pickup);
    if (dropoff) pts.push(dropoff);
    return pts;
  }, [pickup, dropoff]);

  // Kunci bingkai kamera: berubah hanya saat rute/titik benar-benar berganti.
  const frameKey = useMemo(() => {
    const pts = focusPoints.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
    return `${pts}#${activeRoute.length}`;
  }, [focusPoints, activeRoute]);

  const center: [number, number] = pickup
    ? [pickup.lat, pickup.lng]
    : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng];

  // Deteksi mobile untuk konfigurasi peta yang optimal
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  // Mobile-optimized map options
  const mapOptions = useMemo(() => ({
    tap: !isMobile, // Disable tap on mobile to prevent conflicts
    tapTolerance: isMobile ? 16 : 0,
    touchZoom: true, // Allow pinch zoom on mobile
    boxZoom: false, // Disable box zoom on mobile
    doubleClickZoom: !isMobile, // Disable double click zoom on mobile
    scrollWheelZoom: !isMobile, // Disable scroll wheel zoom on mobile (use pinch instead)
    keyboard: !isMobile, // Disable keyboard navigation on mobile
    dragging: true, // Always allow dragging
  }), [isMobile]);

  return (
    <>
      <style>{RODAKU_MAP_CSS}</style>
      <MapContainer
        center={center}
        zoom={DEFAULT_ZOOM}
        className="rodaku-map h-full w-full"
        zoomControl={false}
        {...mapOptions}
      >
        <MapReadyHandler onReady={(map) => {
          mapInstance.current = map;
        }} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {activeRoute.length >= 2 && (
          <>
            {/* Lapisan bayangan jalan */}
            <Polyline
              positions={activeRoute}
              pathOptions={{ color: "#0F172A", weight: 8, opacity: 0.3, lineCap: "round", lineJoin: "round" }}
            />
            {/* Lapisan utama Royal Blue berpendar */}
            <Polyline
              positions={activeRoute}
              pathOptions={{ color: "#1D4ED8", weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round" }}
            />
          </>
        )}

        {pickup && (
          <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
            <Tooltip permanent direction="top" offset={[0, -24]} className="rodaku-tip">
              Titik Jemput
            </Tooltip>
          </Marker>
        )}
        {dropoff && (
          <Marker position={[dropoff.lat, dropoff.lng]} icon={dropoffIcon}>
            <Tooltip permanent direction="top" offset={[0, -24]} className="rodaku-tip">
              Titik Tujuan
            </Tooltip>
          </Marker>
        )}

        <DriverMarker point={driver} vehicleType={vehicleType} heading={heading} />

        <SmartCamera frameKey={frameKey} points={focusPoints} driver={driver} follow={followDriver} />
        <ClickCapture onPickPoint={onPickPoint} />
        <CenterPin active={pickMode} onPickCenter={onPickCenter} />
        <MapResizer />
        <MobileTouchHandler isMobile={isMobile} />
        {isMobile && <ZoomControl position="bottomright" />}
      </MapContainer>
    </>
  );
});

MapComponent.displayName = "Map";

export default MapComponent;

const RODAKU_MAP_CSS = `
  .rodaku-map { background: #e8eef7; }
  .rodaku-map .leaflet-tile-pane { filter: contrast(1.03) saturate(1.08); }
  .rodaku-map .leaflet-tile { filter: saturate(1.18) contrast(1.06); }
  .rodaku-map .leaflet-container { font-family: inherit; }
  @keyframes rodaku-radar {
    0% { transform: scale(.45); opacity: .8; }
    100% { transform: scale(1.55); opacity: 0; }
  }
  @keyframes rodaku-pin-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-12px); }
  }
  .rodaku-tip {
    font-weight: 800 !important;
    font-size: 11px !important;
    color: #0F172A !important;
    background: rgba(255,255,255,.95) !important;
    border: 1px solid #dbe4f3 !important;
    border-radius: 9999px !important;
    padding: 2px 10px !important;
    box-shadow: 0 4px 12px rgba(15,23,42,.18) !important;
  }
  .rodaku-tip::before { display: none !important; }
`;
