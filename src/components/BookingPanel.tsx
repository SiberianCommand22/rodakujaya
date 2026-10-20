"use client";

import { useState } from "react";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import CancelReasonModal from "@/components/CancelReasonModal";
import {
  FARE_MATRIX,
  ORDER_STATUS_META,
  estimateEtaMinutes,
  formatEta,
  formatIDR,
  formatKm,
  type LatLng,
  type OrderStatus,
  type Place,
  type VehicleType,
} from "@/lib/utils";

export type DriverInfo = {
  name: string;
  plateNumber: string;
  rating?: number;
  vehicleLabel?: string;
} | null;

export type RouteQuote = {
  distanceKm: number;
  durationMinutes: number;
  source: "OSRM" | "FALLBACK";
  fare: Record<VehicleType, number>;
};

type BookingPanelProps = {
  pickup: Place | null;
  dropoff: Place | null;
  vehicleType: VehicleType;
  orderStatus: OrderStatus | null;
  isSubmitting: boolean;
  error: string | null;
  driver: DriverInfo;
  driverPoint: LatLng | null;
  quote: RouteQuote | null;
  quoteLoading: boolean;
  onPickupChange: (place: Place | null) => void;
  onDropoffChange: (place: Place | null) => void;
  onVehicleChange: (vehicle: VehicleType) => void;
  onCancelOrder?: (reason: string) => void;
  onOpenChat?: () => void;
  unreadCount?: number;
  onShareTrip?: () => void;
  onReportIssue?: () => void;
  onSubmit: (payload: {
    pickup: Place;
    dropoff: Place;
    vehicleType: VehicleType;
    distanceKm: number;
    fare: number;
    promoCode: string | null;
    discountAmount: number;
    driverNote: string | null;
  }) => void;
};

const FLEET_META: Record<
  VehicleType,
  { icon: string; desc: string; eta: string; capacity: string }
> = {
  RODA_MOTOR: { icon: "🛵", desc: "Cepat & lincah", eta: "3 mnt", capacity: "1 orang" },
  RODA_MOBIL: { icon: "🚗", desc: "Nyaman & lega", eta: "6 mnt", capacity: "4 orang" },
};

const STATUS_BADGE: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: "Driver menuju lokasi jemput",
  PICKING_UP: "Driver telah tiba",
  ON_TRIP: "Menuju tujuan",
  SEARCHING: "Mencari driver",
};

const POPULAR_PLACES: { label: string; address: string; lat: number; lng: number }[] = [
  { label: "Stasiun Bogor", address: "Stasiun Bogor, Bogor Tengah, Kota Bogor", lat: -6.595, lng: 106.79 },
  { label: "Botani Square", address: "Botani Square, Bogor Utara, Kota Bogor", lat: -6.5846, lng: 106.7933 },
  { label: "Sentul City", address: "Sentul City, Babakan Madang, Kab. Bogor", lat: -6.5861, lng: 106.871 },
  { label: "Az Zikra", address: "Perumahan Muslim Az Zikra, Babakan Madang, Kab. Bogor", lat: -6.5588, lng: 106.8622 },
  { label: "STIN", address: "Sekolah Tinggi Intelijen Negara, Babakan Madang, Kab. Bogor", lat: -6.6178, lng: 106.8975 },
  { label: "Ciomas Rahayu", address: "Ciomas Rahayu, Ciomas, Kab. Bogor", lat: -6.6125, lng: 106.7621 },
];

export default function BookingPanel({
  pickup,
  dropoff,
  vehicleType,
  orderStatus,
  isSubmitting,
  error,
  driver,
  driverPoint,
  quote,
  quoteLoading,
  onPickupChange,
  onDropoffChange,
  onVehicleChange,
  onCancelOrder,
  onOpenChat,
  unreadCount = 0,
  onShareTrip,
  onReportIssue,
  onSubmit,
}: BookingPanelProps) {
  const [geoState, setGeoState] = useState<"idle" | "locating" | "error">("idle");
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [driverNote, setDriverNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [shared, setShared] = useState(false);

  const distanceKm = quote?.distanceKm ?? 0;
  const fare = quote?.fare[vehicleType] ?? 0;
  const eta = estimateEtaMinutes(driverPoint, pickup, vehicleType);
  const canSubmit =
    Boolean(pickup && dropoff && quote) &&
    !quoteLoading &&
    !isSubmitting &&
    !orderStatus &&
    !error;

  function detectLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("error");
      setGeoMessage("Geolocation tidak didukung browser ini.");
      return;
    }
    setGeoState("locating");
    setGeoMessage(null);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        // Reverse geocoding via proxy backend (bebas blokir CORS browser).
        try {
          const res = await fetch(
            `/api/geocode?lat=${latitude}&lon=${longitude}`,
            { headers: { Accept: "application/json" } },
          );
          if (res.ok) {
            const data = (await res.json()) as { address?: string | null };
            const address = data.address?.trim();
            if (address) {
              onPickupChange({ lat: latitude, lng: longitude, address });
              setGeoState("idle");
              return;
            }
          }
        } catch {
          // Abaikan — pakai label GPS sebagai fallback.
        }
        onPickupChange({
          lat: latitude,
          lng: longitude,
          address: "Lokasi saya (GPS)",
        });
        setGeoState("idle");
      },
      (err) => {
        setGeoState("error");
        setGeoMessage(
          err.code === err.PERMISSION_DENIED
            ? "Izin lokasi ditolak. Cari alamat jemput secara manual."
            : "Gagal mendeteksi lokasi. Cari alamat jemput secara manual.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function pickPopular(place: (typeof POPULAR_PLACES)[number]) {
    const target = { lat: place.lat, lng: place.lng, address: place.address };
    // Isi slot yang masih kosong dulu: jemput → tujuan, kalau penuh timpa tujuan.
    if (!pickup) onPickupChange(target);
    else if (!dropoff) onDropoffChange(target);
    else onDropoffChange(target);
  }

  function handleSubmit() {
    if (!canSubmit || !pickup || !dropoff || !quote) return;
    const note = driverNote.trim();
    onSubmit({
      pickup,
      dropoff,
      vehicleType,
      distanceKm: quote.distanceKm,
      fare,
      promoCode: null,
      discountAmount: 0,
      driverNote: note.length > 0 ? note.slice(0, 200) : null,
    });
    setDriverNote("");
  }

  async function confirmCancel(reason: string) {
    if (!onCancelOrder) return;
    setCancelBusy(true);
    try {
      await onCancelOrder(reason);
    } finally {
      setCancelBusy(false);
      setCancelOpen(false);
    }
  }

  // ── State 2: Mencari Driver ──────────────────────────────────────────
  if (orderStatus === "SEARCHING") {
    return (
      <div className="flex flex-col items-center gap-4 px-1 py-2 text-center">
        <div className="relative flex h-24 w-24 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1D4ED8]/20" />
          <span className="absolute inline-flex h-16 w-16 animate-ping rounded-full bg-[#1D4ED8]/30 [animation-delay:0.4s]" />
          <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#1D4ED8] text-2xl text-white shadow-xl">
            🛵
          </span>
        </div>
        <div>
          <h2 className="text-base font-bold text-[#0F172A]">Mencari Driver Terdekat...</h2>
          <p className="mt-1 text-xs text-slate-500">
            Kami menghubungi mitra {FARE_MATRIX[vehicleType].label} di sekitar {pickup?.address ?? "lokasi jemput"}.
          </p>
        </div>
        <div className="w-full rounded-2xl bg-[#EFF6FF] px-4 py-3 text-left text-xs text-slate-600">
          <p className="truncate font-semibold text-[#0F172A]">📍 {pickup?.address ?? "-"}</p>
          <p className="mt-1 truncate">🏁 {dropoff?.address ?? "-"}</p>
          <p className="mt-1 font-bold text-[#1D4ED8]">{quote ? `${formatKm(distanceKm)} • ${formatIDR(fare)}` : "Menghitung tarif..."}</p>
        </div>
        {onCancelOrder && (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="w-full rounded-2xl border-2 border-red-200 bg-white py-3 text-sm font-bold text-red-600 transition hover:bg-red-50 min-h-[48px]"
          >
            Batalkan Pesanan
          </button>
        )}
        <CancelReasonModal
          open={cancelOpen}
          busy={cancelBusy}
          onConfirm={(reason) => void confirmCancel(reason)}
          onClose={() => {
            if (!cancelBusy) setCancelOpen(false);
          }}
        />
      </div>
    );
  }

  // ── State 3: Driver ditemukan & perjalanan ───────────────────────────
  // (SEARCHING sudah return di atas, jadi tipenya tersisa ACCEPTED/PICKING_UP/ON_TRIP/COMPLETED/CANCELLED.)
  if (orderStatus === "ACCEPTED" || orderStatus === "PICKING_UP" || orderStatus === "ON_TRIP") {
    const statusMeta = ORDER_STATUS_META[orderStatus];
    return (
      <div className="flex flex-col gap-3 px-1 py-1">
        <div className="flex items-center gap-3 rounded-2xl bg-[#0F172A] p-4 text-white">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1D4ED8] text-lg font-black">
            {(driver?.name ?? "D").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{driver?.name ?? "Mitra Driver"}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-300">
              ★ {(driver?.rating ?? 4.9).toFixed(1)}
              <span className="text-slate-300">• {driver?.vehicleLabel ?? FARE_MATRIX[vehicleType].label}</span>
            </p>
          </div>
          <span className="shrink-0 bg-slate-900 text-white font-mono font-bold px-3 py-1 rounded-lg text-xs border border-slate-700">
            {driver?.plateNumber ?? "-"}
          </span>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-blue-100 bg-[#EFF6FF] px-4 py-2.5 text-xs font-bold text-[#1D4ED8]">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1D4ED8] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#1D4ED8]" />
          </span>
          {STATUS_BADGE[orderStatus] ?? statusMeta.label}
          {eta !== null && (
            <span className="ml-auto font-semibold text-slate-600">ETA {formatEta(eta)}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenChat}
            className="relative rounded-2xl bg-[#1D4ED8] py-3 text-sm font-bold text-white shadow-lg transition hover:bg-[#1E40AF] min-h-[48px]"
          >
            💬 Chat Driver
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white shadow">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="rounded-2xl border-2 border-[#1D4ED8]/20 bg-white py-3 text-center text-sm font-bold text-[#1D4ED8] transition hover:bg-[#EFF6FF] min-h-[48px]"
          >
            🚨 Bantuan
          </button>
        </div>

        {helpOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Pusat Bantuan dan Darurat RODAKU"
            className="fixed inset-0 z-[3000] flex items-center justify-center bg-[#0F172A]/60 p-4 backdrop-blur-sm"
            onClick={() => setHelpOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-base font-black text-[#0F172A]">
                🆘 Pusat Bantuan &amp; Darurat RODAKU
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Bantuan in-app tanpa membuka aplikasi lain. Semua aksi aman di dalam aplikasi.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onShareTrip?.();
                    setShared(true);
                  }}
                  className="w-full rounded-2xl bg-[#1D4ED8] py-3 text-sm font-bold text-white transition hover:bg-[#1E40AF] min-h-[48px]"
                >
                  📍 {shared ? "Lokasi Perjalanan Dibagikan ✓" : "Bagikan Lokasi Perjalanan"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onReportIssue?.();
                    setHelpOpen(false);
                  }}
                  className="w-full rounded-2xl border-2 border-amber-200 bg-amber-50 py-3 text-sm font-bold text-amber-800 transition hover:bg-amber-100 min-h-[48px]"
                >
                  📝 Lapor Kendala ke Admin
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHelpOpen(false);
                    onOpenChat?.();
                  }}
                  className="w-full rounded-2xl border-2 border-emerald-200 bg-emerald-50 py-3 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 min-h-[48px]"
                >
                  💬 Hubungi via Chat
                </button>
                <button
                  type="button"
                  onClick={() => setHelpOpen(false)}
                  className="w-full rounded-2xl py-3 text-xs font-semibold text-slate-500 hover:bg-slate-50 min-h-[48px]"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}

        {onCancelOrder && (orderStatus === "ACCEPTED" || orderStatus === "PICKING_UP") && (
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="w-full rounded-2xl py-3 text-xs font-semibold text-red-500 hover:bg-red-50 min-h-[48px]"
          >
            Batalkan pesanan
          </button>
        )}
        <CancelReasonModal
          open={cancelOpen}
          busy={cancelBusy}
          onConfirm={(reason) => void confirmCancel(reason)}
          onClose={() => {
            if (!cancelBusy) setCancelOpen(false);
          }}
        />
      </div>
    );
  }

  // ── State 1: Pencarian & pemilihan armada ────────────────────────────
  return (
    <div className="flex flex-col gap-2.5 overflow-visible px-1">
      {error && (
        <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5 overflow-visible">
        <AddressAutocomplete
          key={pickup?.address ?? "pickup-empty"}
          label="Jemput"
          placeholder="Mau dijemput di mana?"
          value={pickup}
          address={pickup?.address ?? null}
          onSelect={(point, address) => onPickupChange({ ...point, address })}
          onClear={() => {
            onPickupChange(null);
            setDriverNote("");
          }}
          disabled={Boolean(orderStatus)}
        />
        <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50/60 px-3 py-1.5">
          <span aria-hidden className="shrink-0 text-xs text-slate-400">📝</span>
          <input
            type="text"
            value={driverNote}
            onChange={(e) => setDriverNote(e.target.value.slice(0, 200))}
            disabled={Boolean(orderStatus)}
            placeholder="Catatan untuk driver (misal: tunggu di lobi utara / pagar hitam)"
            aria-label="Catatan untuk driver"
            className="w-full bg-transparent text-xs text-[#0F172A] outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
          {driverNote.length > 0 && (
            <button
              type="button"
              onClick={() => setDriverNote("")}
              aria-label="Hapus catatan"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-500 transition hover:bg-slate-300"
            >
              ✕
            </button>
          )}
        </div>
        <AddressAutocomplete
          key={dropoff?.address ?? "dropoff-empty"}
          label="Tujuan"
          placeholder="Mau pergi ke mana?"
          value={dropoff}
          address={dropoff?.address ?? null}
          onSelect={(point, address) => onDropoffChange({ ...point, address })}
          onClear={() => onDropoffChange(null)}
          accent="success"
          disabled={Boolean(orderStatus)}
        />
        <button
          type="button"
          onClick={detectLocation}
          disabled={geoState === "locating" || Boolean(orderStatus)}
          className="self-end rounded-full bg-[#EFF6FF] px-3 py-2 text-[11px] font-bold text-[#1D4ED8] transition hover:bg-blue-100 disabled:opacity-60 min-h-[48px]"
        >
          📍 {geoState === "locating" ? "Mendeteksi..." : "Lokasi Saya"}
        </button>
        {geoMessage && (
          <p className="rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">{geoMessage}</p>
        )}
        <div className="rounded-2xl bg-slate-50 px-2.5 py-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Lokasi Populer
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {POPULAR_PLACES.map((place) => (
              <button
                key={place.label}
                type="button"
                onClick={() => pickPopular(place)}
                disabled={Boolean(orderStatus)}
                title={place.address}
                className="rounded-full bg-white px-3 py-2 text-[11px] font-bold text-[#1D4ED8] shadow-sm ring-1 ring-blue-100 transition hover:bg-[#EFF6FF] disabled:opacity-60 min-h-[48px]"
              >
                📍 {place.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Pilih armada
        </p>

        <div className="mt-2 flex flex-col gap-1.5">
          {(Object.keys(FARE_MATRIX) as VehicleType[]).map((key) => {
            const option = FARE_MATRIX[key];
            const meta = FLEET_META[key];
            const active = key === vehicleType;
            const original = quote?.fare[key] ?? null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onVehicleChange(key)}
                disabled={Boolean(orderStatus)}
                aria-pressed={active}
                className={`flex items-center gap-2.5 rounded-2xl border-2 p-3 text-left transition disabled:opacity-60 min-h-[48px] ${
                  active
                    ? "border-[#1D4ED8] bg-blue-50/60 shadow-lg"
                    : "border-slate-100 bg-white hover:border-blue-200 hover:shadow-md"
                }`}
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-2xl ${
                    active ? "bg-[#1D4ED8]/10" : "bg-slate-100"
                  }`}
                  aria-hidden
                >
                  {meta.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-black text-[#0F172A]">
                      {option.label}
                    </span>
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                      {meta.eta}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                    {meta.desc} • {meta.capacity}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-sm font-black tabular-nums text-[#0F172A]">
                    {original !== null ? formatIDR(original) : quoteLoading ? "…" : "-"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-slate-400">
          {quote
            ? `${formatKm(distanceKm)} • ${quote.durationMinutes} mnt${quote.source === "FALLBACK" ? " (estimasi)" : ""}`
            : quoteLoading
              ? "Menghitung rute & tarif..."
              : "Isi jemput & tujuan untuk melihat tarif."}
        </p>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full rounded-2xl bg-[#1D4ED8] py-4 text-base font-black text-white shadow-xl transition hover:bg-[#1E40AF] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none min-h-[56px]"
      >
        {isSubmitting ? "Mengirim..." : `Pesan ${FARE_MATRIX[vehicleType].label}`}
      </button>
    </div>
  );
}
