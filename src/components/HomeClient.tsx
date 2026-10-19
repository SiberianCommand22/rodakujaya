"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import AuthPanel, { type AuthUser } from "@/components/AuthPanel";
import BookingPanel, { type RouteQuote } from "@/components/BookingPanel";
import ChatDrawer from "@/components/ChatDrawer";
import DriverTracker, {
  CONNECTION_LABEL,
  type ConnectionState,
} from "@/components/DriverTracker";
import OrderHistoryDrawer from "@/components/OrderHistoryDrawer";
import RodakuLogo from "@/components/RodakuLogo";
import { portalLogout } from "@/lib/sessionClient";
import TripSummaryModal, {
  type TripSummary,
} from "@/components/TripSummaryModal";
import { SOCKET_EVENTS, getSocket } from "@/lib/socket";
import { reverseGeocode } from "@/lib/geocode";
import { nextQueueIndex } from "@/lib/tripSettlement";
import { type LatLng, type OrderStatus, type Place, type VehicleType } from "@/lib/utils";
import type { MapRef } from "@/components/Map";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#EFF6FF] text-sm text-[#1D4ED8]">
      Memuat peta...
    </div>
  ),
});

type DriverCard = { name: string; plateNumber: string; rating: number; vehicleLabel: string };

export default function HomeClient({
  initialUser,
}: {
  initialUser: AuthUser | null;
}) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(initialUser);

  // Landing vs aplikasi pemesanan. Peta hanya dirender di mode "app".
  const [view, setView] = useState<"landing" | "app">("landing");
  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"CUSTOMER" | "DRIVER">("CUSTOMER");

  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType>("RODA_MOTOR");
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);
  const [driverPoint, setDriverPoint] = useState<LatLng | null>(null);
  const [driverHeading, setDriverHeading] = useState<number | null>(null);
  const [driver, setDriver] = useState<DriverCard | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<"pickup" | "dropoff">("dropoff");
  const [mapPickMode, setMapPickMode] = useState(false);
  const [pickBusy, setPickBusy] = useState(false);
  const [pickLabel, setPickLabel] = useState<string | null>(null);
  const pickBusyRef = useRef(false);
  const [sheetExpanded, setSheetExpanded] = useState(true);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const mapRef = useRef<MapRef | null>(null);

  const [quote, setQuote] = useState<RouteQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][] | null>(null);
  const [chatSignal, setChatSignal] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [pendingQueue, setPendingQueue] = useState<
    { orderId: string; fare: number; needsReview: boolean }[]
  >([]);

  const quoteSeq = useRef(0);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (!pickup || !dropoff) return;
    const seq = ++quoteSeq.current;
    const controller = new AbortController();
    const params = new URLSearchParams({
      pickupLat: String(pickup.lat),
      pickupLng: String(pickup.lng),
      dropLat: String(dropoff.lat),
      dropLng: String(dropoff.lng),
    });
    fetch(`/api/routing?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (seq === quoteSeq.current) setQuoteLoading(true);
        if (!res.ok) throw new Error("routing failed");
        return (await res.json()) as {
          distanceKm: number;
          durationMinutes: number;
          source: "OSRM" | "FALLBACK";
          fare: Record<VehicleType, number>;
          geometry: { coordinates: [number, number][] };
        };
      })
      .then((data) => {
        if (seq !== quoteSeq.current) return;
        setQuote({
          distanceKm: data.distanceKm,
          durationMinutes: data.durationMinutes,
          source: data.source,
          fare: data.fare,
        });
        setRouteGeometry(
          data.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
        );
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        if (seq === quoteSeq.current) setQuote(null);
      })
      .finally(() => {
        if (seq === quoteSeq.current) setQuoteLoading(false);
      });
    return () => controller.abort();
  }, [pickup, dropoff]);

  const toSummary = useCallback(
    (order: {
      id: string;
      status: string;
      distanceKm: number;
      durationMinutes: number | null;
      fare: number;
      vehicleType: string;
      routeSource: string | null;
      pickupAddress: string | null;
      dropoffAddress: string | null;
      updatedAt: string;
      customer: { name: string } | null;
      driver: {
        plateNumber: string;
        user: {
          name: string;
          bankName?: string | null;
          accountNumber?: string | null;
          accountHolderName?: string | null;
        };
      } | null;
      payment: { status: string; method?: string | null } | null;
    }): TripSummary => ({
      orderId: order.id,
      distanceKm: order.distanceKm,
      durationMinutes: order.durationMinutes,
      fare: order.fare,
      vehicleType: order.vehicleType,
      routeSource: order.routeSource,
      driverName: order.driver?.user?.name ?? null,
      plateNumber: order.driver?.plateNumber ?? null,
      pickupAddress: order.pickupAddress,
      dropoffAddress: order.dropoffAddress,
      orderStatus: order.status,
      paymentStatus: (order.payment?.status ?? null) as TripSummary["paymentStatus"],
      method: (order.payment?.method ?? null) as TripSummary["method"],
      bankName: order.driver?.user?.bankName ?? null,
      accountNumber: order.driver?.user?.accountNumber ?? null,
      accountHolderName: order.driver?.user?.accountHolderName ?? null,
      paid: order.payment?.status === "PAID",
      customerName: order.customer?.name ?? user?.name ?? null,
      completedAt: order.status === "COMPLETED" ? order.updatedAt : null,
    }),
    [user?.name],
  );

  type CompletedOrderView = Parameters<typeof toSummary>[0];

  /**
   * Perjalanan yang menunggu penyelesaian: AWAITING_PAYMENT (transfer P2P
   * belum dikonfirmasi driver) atau COMPLETED dengan pembayaran belum lunas
   * → modal struk. Sudah lunas → hanya langkah ulasan.
   */
  const presentCompletedOrder = useCallback(
    (order: CompletedOrderView) => {
      const paid = order.payment?.status === "PAID";
      const awaiting =
        order.status === "AWAITING_PAYMENT" ||
        (order.status === "COMPLETED" && !paid);
      if (!paid && !awaiting) return;
      setSummary(toSummary(order));
      setSummaryOpen(true);
    },
    [toSummary],
  );

  useEffect(() => {
    if (!user || user.role === "DRIVER") return;
    let cancelled = false;
    fetch("/api/orders?limit=20")
      .then(async (res) => (res.ok ? await res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const queue: { orderId: string; fare: number; needsReview: boolean }[] =
          data.pendingSettlements ?? [];
        setPendingQueue(queue);
        const head = queue[0]
          ? (data.recent ?? []).find((o: { id: string }) => o.id === queue[0].orderId)
          : null;
        if (head) {
          presentCompletedOrder(head);
          return;
        }
        const active = (data.active ?? [])[0];
        if (!active) return;
        setOrderId(active.id);
        setOrderStatus(active.status);
        setVehicleType(active.vehicleType);
        setPickup({
          lat: active.pickupLat,
          lng: active.pickupLng,
          address: active.pickupAddress ?? "Titik jemput",
        });
        setDropoff({
          lat: active.dropoffLat,
          lng: active.dropoffLng,
          address: active.dropoffAddress ?? "Tujuan",
        });
        const last = active.driver;
        if (last && typeof last.lastLat === "number" && typeof last.lastLng === "number") {
          setDriverPoint({ lat: last.lastLat, lng: last.lastLng });
        }
        if (active.driver?.user?.name) {
          setDriver({
            name: active.driver.user.name,
            plateNumber: active.driver.plateNumber,
            rating: 4.9,
            vehicleLabel: active.vehicleType === "RODA_MOBIL" ? "RodaMobil" : "RodaMotor",
          });
        }
        const socket = getSocket();
        if (!socket.connected) socket.connect();
        socket.emit(SOCKET_EVENTS.TRACK_ORDER, active.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, toSummary, presentCompletedOrder]);

  const openSummary = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/orders?limit=20`);
        if (!res.ok) return;
        const data = await res.json();
        const order = (data.recent ?? []).find((o: { id: string }) => o.id === id);
        if (!order) return;
        setPendingQueue(data.pendingSettlements ?? []);
        presentCompletedOrder(order);
      } catch {
        /* best-effort */
      }
    },
    [presentCompletedOrder],
  );

  const resetToBooking = useCallback(() => {
    setSummaryOpen(false);
    setSummary(null);
    setPendingQueue([]);
    setOrderId(null);
    setOrderStatus(null);
    setPickup(null);
    setDropoff(null);
    setDriver(null);
    setDriverPoint(null);
    setDriverHeading(null);
    setQuote(null);
    setRouteGeometry(null);
  }, []);

  const advanceQueue = useCallback(
    async (settledOrderId: string) => {
      try {
        const res = await fetch("/api/orders?limit=20");
        if (!res.ok) throw new Error("gagal memuat antrean");
        const data = await res.json();
        const queue: { orderId: string; fare: number; needsReview: boolean }[] =
          data.pendingSettlements ?? [];
        setPendingQueue(queue);
        const nextIndex = nextQueueIndex(queue, settledOrderId);
        if (nextIndex === null) {
          resetToBooking();
          return;
        }
        const next = (data.recent ?? []).find(
          (o: { id: string }) => o.id === queue[nextIndex].orderId,
        );
        if (!next) {
          resetToBooking();
          return;
        }
        presentCompletedOrder(next);
      } catch {
        resetToBooking();
      }
    },
    [presentCompletedOrder, resetToBooking],
  );

  /**
   * Refresh setelah pembayaran CASH: isi ulang antrean lalu tampilkan struk
   * lunas untuk langkah ulasan.
   */
  const handlePaymentUpdate = useCallback(async () => {
    if (!summary) return;
    try {
      const res = await fetch(`/api/orders?limit=20`);
      if (!res.ok) return;
      const data = await res.json();
      const order = (data.recent ?? []).find(
        (o: { id: string }) => o.id === summary.orderId,
      );
      setPendingQueue(data.pendingSettlements ?? []);
      if (order) {
        setSummary(toSummary(order));
        setSummaryOpen(true);
      }
    } catch {
      /* best-effort: antrean ulasan bisa dibuka dari riwayat */
    }
  }, [summary, toSummary]);

  function clearQuote() {
    setQuote(null);
    setRouteGeometry(null);
  }
  function applyPickup(place: Place | null) {
    setPickup(place);
    if (!place) clearQuote();
    else if (place.lat && place.lng) {
      mapRef.current?.flyTo({ lat: place.lat, lng: place.lng }, 16, 0.8);
    }
  }
  function applyDropoff(place: Place | null) {
    setDropoff(place);
    if (!place) clearQuote();
    else if (place.lat && place.lng) {
      mapRef.current?.flyTo({ lat: place.lat, lng: place.lng }, 16, 0.8);
    }
  }

  /**
   * Klik Peta Langsung: saat kolom Jemput/Tujuan aktif (atau kosong),
   * klik titik mana pun menaruh pin dan otomatis mengisi nama jalannya
   * via reverse-geocode.
   */
  const handlePickPoint = useCallback(
    (point: LatLng) => {
      if (orderStatus) return;
      const target = !pickup ? "pickup" : !dropoff ? "dropoff" : pendingTarget;
      if (target === "pickup") {
        setPickup({ ...point, address: "Mencari nama jalan…" });
        setPendingTarget("dropoff");
        void reverseGeocode(point.lat, point.lng).then((address) => {
          setPickup({ ...point, address: address ?? "Titik jemput (peta)" });
        });
      } else {
        setDropoff({ ...point, address: "Mencari nama jalan…" });
        void reverseGeocode(point.lat, point.lng).then((address) => {
          setDropoff({ ...point, address: address ?? "Tujuan (peta)" });
        });
      }
    },
    [pendingTarget, pickup, dropoff, orderStatus],
  );

  /**
   * Mode "Geser Peta": saat peta berhenti digeser, reverse-geocode koordinat
   * tengah menjadi nama lokasi lalu isi slot jemput/tujuan yang aktif.
   */
  const handlePickCenter = useCallback(
    async (point: LatLng) => {
      if (pickBusyRef.current) return;
      pickBusyRef.current = true;
      setPickBusy(true);
      setPickLabel("Mencari nama lokasi…");
      try {
        const address = await reverseGeocode(point.lat, point.lng);
        const named = { ...point, address: address ?? "Titik pilihan (peta)" };
        if (pendingTarget === "pickup") {
          setPickup(named);
          setPendingTarget("dropoff");
        } else {
          setDropoff(named);
        }
        setPickLabel(address ?? "Titik dipilih dari peta");
      } finally {
        pickBusyRef.current = false;
        setPickBusy(false);
      }
    },
    [pendingTarget],
  );

  const handleSubmit = useCallback(
    async (payload: { pickup: Place; dropoff: Place; vehicleType: VehicleType; distanceKm: number; fare: number; promoCode: string | null; discountAmount: number; driverNote: string | null }) => {
      setIsSubmitting(true);
      setError(null);
      try {
        const response = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pickupLat: payload.pickup.lat,
            pickupLng: payload.pickup.lng,
            pickupAddr: payload.pickup.address,
            dropLat: payload.dropoff.lat,
            dropLng: payload.dropoff.lng,
            dropAddr: payload.dropoff.address,
            vehicleType: payload.vehicleType,
            price: payload.fare,
            promoCode: payload.promoCode,
            discountAmount: payload.discountAmount,
            driverNote: payload.driverNote,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.message ?? data?.error ?? "Gagal membuat pesanan");
        }
        const order = data.order;
        setOrderId(order.id);
        setOrderStatus("SEARCHING");
        setSheetExpanded(true);
        setMapPickMode(false);
        const socket = getSocket();
        if (!socket.connected) socket.connect();
        socket.emit(SOCKET_EVENTS.TRACK_ORDER, order.id);
        socket.emit(SOCKET_EVENTS.ORDER_CREATED, {
          id: order.id,
          vehicleType: order.vehicleType,
          pickupLat: order.pickupLat,
          pickupLng: order.pickupLng,
          dropoffLat: order.dropoffLat,
          dropoffLng: order.dropoffLng,
          pickupAddress: order.pickupAddress,
          dropoffAddress: order.dropoffAddress,
          distanceKm: order.distanceKm,
          fare: order.fare,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Terjadi kesalahan");
        setOrderStatus(null);
        setOrderId(null);
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  const handleCancelOrder = useCallback(async (reason: string) => {
    if (!orderId) return;
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: "CANCELLED", cancelReason: reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "Gagal membatalkan pesanan");
      }
      getSocket().emit(SOCKET_EVENTS.ORDER_STATUS_UPDATE, {
        orderId,
        status: "CANCELLED",
        cancelReason: reason,
      });
      resetToBooking();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membatalkan pesanan");
    }
  }, [orderId, resetToBooking]);

  async function handleLogout() {
    await portalLogout("CUSTOMER");
    setUser(null);
    setAuthOpen(false);
    setView("landing");
    resetToBooking();
  }

  function openAuth(tab: "CUSTOMER" | "DRIVER") {
    setAuthTab(tab);
    setAuthOpen(true);
  }

  function handleAuthenticated(next: AuthUser) {
    setUser(next);
    setAuthOpen(false);
    // AuthPanel sudah push /driver untuk peran DRIVER.
    if (next.role === "CUSTOMER") setView("app");
  }

  function handlePesan() {
    if (!user) {
      openAuth("CUSTOMER");
      return;
    }
    if (user.role === "DRIVER") {
      router.push("/driver");
      return;
    }
    if (user.role !== "CUSTOMER") return;
    setView("app");
  }

  function handleMitra() {
    if (user?.role === "DRIVER") {
      router.push("/driver");
      return;
    }
    openAuth("DRIVER");
  }

  const showApp = view === "app" && user?.role === "CUSTOMER";

  // ── Mode aplikasi pemesanan (peta + bottom sheet) ────────────────────────
  if (showApp && user) {
    return (
      <div className="relative h-[100dvh] w-full overflow-hidden bg-[#EFF6FF]" style={{ touchAction: "pan-x pan-y" }}>
        {/* Peta utama memenuhi 100% viewport sebagai kanvas latar */}
        <div className="absolute inset-0 h-[100dvh] w-full" style={{ touchAction: "pan-x pan-y" }}>
          <Map
            ref={mapRef}
            onMapReady={(ref) => { mapRef.current = ref; }}
            pickup={pickup}
            dropoff={dropoff}
            driver={driverPoint}
            vehicleType={vehicleType}
            heading={driverHeading}
            route={routeGeometry}
            onPickPoint={handlePickPoint}
            followDriver={orderStatus === "PICKING_UP" || orderStatus === "ON_TRIP"}
            pickMode={mapPickMode && !orderStatus}
            onPickCenter={handlePickCenter}
          />
        </div>

        {/* Kontrol mode "Geser Peta" */}
        <div className="absolute right-3 top-32 z-[1000] flex flex-col items-end gap-2 md:top-36">
          <button
            type="button"
            onClick={() => {
              setMapPickMode((v) => !v);
              setPickLabel(null);
            }}
            aria-pressed={mapPickMode}
            className={`rounded-full px-4 py-3 text-[11px] font-black shadow-xl backdrop-blur transition min-h-[48px] ${
              mapPickMode
                ? "bg-[#0F172A] text-white"
                : "bg-white/95 text-[#1D4ED8] hover:bg-white"
            }`}
          >
            📍 {mapPickMode ? "Selesai Memilih" : "Geser Peta"}
          </button>
        </div>
        {mapPickMode && !orderStatus && (
          <div className="pointer-events-none absolute inset-x-0 top-28 z-[1000] flex justify-center px-3">
            <p className="max-w-md truncate rounded-full bg-[#0F172A]/90 px-4 py-2 text-center text-[11px] font-bold text-white shadow-xl backdrop-blur">
              {pickBusy
                ? "Mencari nama lokasi…"
                : (pickLabel ?? `Geser peta, lepas untuk memilih ${pendingTarget === "pickup" ? "titik jemput" : "titik tujuan"}`)}
            </p>
          </div>
        )}

        {/* Floating header ala Gojek: offset kanan sidebar di desktop */}
        <header className="absolute inset-x-0 top-0 z-[1000] px-3 pt-3 md:left-[460px] md:px-6 md:pt-5">
          <div className="mx-auto flex max-w-2xl items-center gap-2 md:mx-0 md:max-w-none">
            <button
              type="button"
              onClick={() => setView("landing")}
              className="flex items-center gap-1.5 rounded-2xl bg-white/95 px-3 py-3 text-xs font-black text-[#0F172A] shadow-xl backdrop-blur transition hover:bg-white min-h-[48px]"
            >
              ← Beranda
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                aria-label="Riwayat pesanan"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-sm shadow-xl backdrop-blur"
              >
                🧾
              </button>
              <button
                type="button"
                onClick={() => router.push("/profile")}
                aria-label="Profil dan rekening bank"
                title={`${user.name} — Profil & Rekening`}
                className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[#1D4ED8] text-sm font-black text-white shadow-xl"
              >
                {user.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatar} alt={user.name} width={36} height={36} className="h-12 w-12 object-cover" />
                ) : (
                  user.name.charAt(0).toUpperCase()
                )}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full bg-red-500/95 px-3 py-3 text-xs font-black text-white shadow-xl backdrop-blur transition hover:bg-red-600 min-h-[48px]"
              >
                Keluar
              </button>
            </div>
          </div>

          <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 md:mx-0 md:max-w-none md:justify-start">
            {(
              [
                { key: "pickup", label: "📍 Jemput" },
                { key: "dropoff", label: "🏁 Tujuan" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setPendingTarget(tab.key)}
                className={`rounded-full px-4 py-2.5 text-[11px] font-bold shadow-lg backdrop-blur transition min-h-[48px] ${
                  pendingTarget === tab.key ? "bg-[#1D4ED8] text-white" : "bg-white/95 text-[#0F172A]"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <span
              className={`rounded-full px-3 py-1.5 text-[10px] font-bold shadow-lg backdrop-blur ${
                connection === "live" ? "bg-emerald-500 text-white" : "bg-white/90 text-slate-600"
              }`}
            >
              {CONNECTION_LABEL[connection]}
            </span>
          </div>
        </header>

        {/* Panel interaksi: floating sidebar di desktop, bottom sheet di mobile */}
        <div
          className={`absolute inset-x-0 bottom-0 z-[1000] transition-transform duration-300 ease-out ${
            isMobile
              ? "md:inset-x-auto md:bottom-6 md:left-6 md:top-6 md:flex md:w-full md:max-w-[420px]"
              : "md:inset-x-auto md:bottom-6 md:left-6 md:top-6 md:flex md:w-full md:max-w-[420px]"
          }`}
          style={isMobile ? { transform: sheetExpanded ? "translateY(0)" : "translateY(calc(100% - 72px))" } : undefined}
        >
          <div
            className={`mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] border border-blue-50/50 bg-white/95 shadow-[0_-12px_40px_rgba(15,23,42,0.25)] backdrop-blur-md transition-all duration-300 ${
              isMobile
                ? "max-h-[85dvh] rounded-t-3xl"
                : "max-h-[92vh] md:w-full md:max-w-[420px] md:rounded-3xl md:shadow-2xl"
            }`}
            ref={(el) => {
              if (el && isMobile) setSheetHeight(el.offsetHeight);
            }}
          >
            <div className="border-b border-slate-100 px-4 pb-2 pt-2 md:px-5 md:pt-4">
              <div className="flex items-center gap-2">
                <span className="hidden md:flex">
                  <RodakuLogo size="sm" variant="dark" />
                </span>
                <div className="hidden md:block">
                  <p className="text-[11px] text-slate-500">Mau pergi ke mana hari ini?</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSheetExpanded((v) => !v)}
                  aria-label={sheetExpanded ? "Ciutkan panel" : "Bentangkan panel"}
                  className="mx-auto flex flex-col items-center gap-1 rounded-full px-6 py-1 md:mx-0 md:ml-auto"
                >
                  <span className="h-1.5 w-12 rounded-full bg-slate-200 md:hidden" aria-hidden />
                  <span className="hidden text-[10px] font-bold uppercase tracking-widest text-slate-400 md:block">
                    {sheetExpanded ? "ciutkan ▾" : "bentangkan ▴"}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 md:hidden">
                    {sheetExpanded ? "geser untuk menciutkan" : orderStatus ? "status perjalanan ▲" : "pesan rodaku ▲"}
                  </span>
                </button>
              </div>
            </div>
            <div
              className={`min-h-0 overflow-y-auto px-4 pb-5 pt-3 md:px-5 ${
                sheetExpanded ? "flex-1" : "hidden md:block md:flex-1"
              }`}
            >
              {shareNote && (
                <p className="mb-2 rounded-2xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700" role="status">
                  {shareNote}
                </p>
              )}
              <BookingPanel
                pickup={pickup}
                dropoff={dropoff}
                vehicleType={vehicleType}
                orderStatus={orderStatus}
                isSubmitting={isSubmitting}
                error={error}
                driver={driver}
                driverPoint={driverPoint}
                quote={quote}
                quoteLoading={quoteLoading}
                onPickupChange={applyPickup}
                onDropoffChange={applyDropoff}
                onVehicleChange={setVehicleType}
                onCancelOrder={handleCancelOrder}
                onOpenChat={() => setChatSignal((n) => n + 1)}
                unreadCount={chatUnread}
                onShareTrip={() => {
                  const text = pickup && dropoff
                    ? `Lokasi perjalanan dibagikan: ${pickup.address} → ${dropoff.address}`
                    : "Lokasi perjalanan dibagikan ke kontak darurat.";
                  setShareNote(`📍 ${text}`);
                  try {
                    void navigator.clipboard?.writeText(text);
                  } catch {
                    /* abaikan */
                  }
                }}
                onReportIssue={() => {
                  setChatSignal((n) => n + 1);
                  setShareNote("📝 Laporan kendala diteruskan ke admin via chat.");
                }}
                onSubmit={handleSubmit}
              />
            </div>
          </div>
        </div>

        <DriverTracker
          orderId={orderId}
          onConnectionChange={setConnection}
          onLocation={(payload) => {
            setDriverPoint({ lat: payload.lat, lng: payload.lng });
            if (typeof payload.heading === "number" && Number.isFinite(payload.heading)) {
              setDriverHeading(payload.heading);
            }
          }}
          onStatus={(payload) => {
            setOrderStatus(payload.status);
            if (payload.plateNumber) {
              setDriver((prev) => ({
                name: prev?.name ?? "Mitra Driver",
                plateNumber: payload.plateNumber ?? prev?.plateNumber ?? "-",
                rating: prev?.rating ?? 4.9,
                vehicleLabel: prev?.vehicleLabel ?? (vehicleType === "RODA_MOBIL" ? "RodaMobil" : "RodaMotor"),
              }));
            }
            if (
              (payload.status === "COMPLETED" || payload.status === "AWAITING_PAYMENT") &&
              payload.orderId
            ) {
              void openSummary(payload.orderId);
            }
            if (payload.status === "CANCELLED") {
              resetToBooking();
            }
          }}
        />

        <ChatDrawer
          key={orderId ?? "chat-none"}
          orderId={orderId}
          status={orderStatus}
          selfId={user.id}
          selfName={user.name}
          selfRole="CUSTOMER"
          peerName={driver?.name ?? null}
          openSignal={chatSignal}
          onUnreadChange={setChatUnread}
        />

        <TripSummaryModal
          key={summary?.orderId ?? "none"}
          open={summaryOpen}
          summary={summary}
          queue={pendingQueue}
          onClose={() => setSummaryOpen(false)}
          onSettled={() => {
            if (summary) void advanceQueue(summary.orderId);
          }}
          onPaymentUpdate={() => void handlePaymentUpdate()}
        />

        <OrderHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
      </div>
    );
  }

  // ── Landing page resmi RODAKU (tanpa peta publik) ─────────────────────────
  return (
    <div className="min-h-dvh bg-white text-[#0F172A]">
      {/* Single clean navbar — glassmorphism */}
      <header className="fixed top-0 inset-x-0 z-50 h-20 bg-white/85 backdrop-blur-xl border-b border-slate-100 shadow-sm transition-all">
        <div className="mx-auto flex h-full max-w-6xl items-center gap-4 px-4">
          <a
            href="#beranda"
            aria-label="RODAKU — Beranda"
            className="transition-transform duration-300 hover:scale-[1.03] hover:opacity-90"
          >
            <RodakuLogo size="md" variant="dark" />
          </a>
          <div className="ml-auto flex items-center gap-2">
            {!user ? (
              <button
                type="button"
                onClick={() => openAuth("CUSTOMER")}
                className="bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] text-white font-bold text-sm px-6 py-2.5 rounded-full shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all"
              >
                Masuk / Login
              </button>
            ) : user.role === "CUSTOMER" ? (
              <>
                {user.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatar}
                    alt={user.name}
                    width={32}
                    height={32}
                    className="hidden h-8 w-8 rounded-full border border-slate-200 object-cover sm:block"
                  />
                ) : (
                  <span className="hidden h-8 w-8 items-center justify-center rounded-full bg-[#1D4ED8] text-xs font-black text-white sm:flex">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="hidden max-w-32 truncate text-sm font-bold text-slate-700 lg:block">
                  {user.name}
                </span>
                <button
                  type="button"
                  onClick={() => setView("app")}
                  className="bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] text-white font-bold text-xs px-5 py-2.5 rounded-full shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all"
                >
                  Buka Aplikasi / Pesan
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
                >
                  Keluar
                </button>
              </>
            ) : user.role === "DRIVER" ? (
              <>
                <span className="hidden max-w-32 truncate text-sm font-bold text-slate-700 lg:block">
                  {user.name}
                </span>
                <Link
                  href="/driver"
                  className="bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] hover:from-[#1D4ED8] hover:to-[#1E40AF] text-white font-bold text-xs px-5 py-2.5 rounded-full shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all"
                >
                  Buka Konsol Driver
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
                >
                  Keluar
                </button>
              </>
            ) : (
              <>
                <span className="hidden max-w-32 truncate text-sm font-bold text-slate-700 lg:block">
                  {user.name}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
                >
                  Keluar
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="beranda" className="pt-20">
        {/* Hero section */}
        <section className="bg-gradient-to-b from-[#EFF6FF] to-white">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-12 md:grid-cols-2 md:pt-20">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-[11px] font-black uppercase tracking-widest text-[#1D4ED8] shadow ring-1 ring-blue-100">
                🛵🚗 Transportasi on-demand
              </p>
              <h1 className="mt-4 text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">
                Perjalanan Cepat, Nyaman, dan Hemat Bersama{" "}
                <span className="text-[#1D4ED8]">RODAKU</span>
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600 md:text-lg">
                Layanan transportasi on-demand roda dua dan roda empat siap mengantar Anda
                ke mana saja dengan aman.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handlePesan}
                  className="rounded-2xl bg-[#1D4ED8] px-6 py-4 text-sm font-black text-white shadow-xl transition hover:bg-[#1E40AF]"
                >
                  Pesan Perjalanan Sekarang →
                </button>
                <button
                  type="button"
                  onClick={handleMitra}
                  className="rounded-2xl border-2 border-[#1D4ED8]/20 bg-white px-6 py-4 text-sm font-black text-[#1D4ED8] transition hover:border-[#1D4ED8] hover:bg-[#EFF6FF]"
                >
                  Gabung Jadi Mitra Driver
                </button>
              </div>
              <dl className="mt-8 grid max-w-md grid-cols-3 gap-3 text-center">
                {[
                  { value: "OSRM", label: "Rute jalan nyata" },
                  { value: "2", label: "Pilihan armada" },
                  { value: "100%", label: "Ke driver" },
                ].map((s) => (
                  <div key={s.label} className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
                    <dt className="text-base font-black text-[#0F172A]">{s.value}</dt>
                    <dd className="mt-0.5 text-[11px] font-semibold text-slate-500">{s.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="relative">
              <div className="overflow-hidden rounded-[28px] bg-[#0F172A] p-6 text-white shadow-2xl">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-black">RODAKU App Preview</p>
                  <span className="rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-black">● Live</span>
                </div>
                <div className="mt-4 rounded-2xl bg-white/10 p-4 backdrop-blur">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Estimasi perjalanan</p>
                  <p className="mt-1 text-2xl font-black">📍 Jemput → 🏁 Tujuan</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-white p-3 text-[#0F172A]">
                      <p className="text-xl">🛵</p>
                      <p className="text-xs font-black">RodaMotor</p>
                      <p className="text-[11px] font-bold text-[#1D4ED8]">Mulai Rp 8rb</p>
                    </div>
                    <div className="rounded-xl bg-white p-3 text-[#0F172A]">
                      <p className="text-xl">🚗</p>
                      <p className="text-xs font-black">RodaMobil</p>
                      <p className="text-[11px] font-bold text-[#1D4ED8]">Mulai Rp 15rb</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handlePesan}
                    className="mt-3 w-full rounded-xl bg-[#1D4ED8] py-3 text-sm font-black text-white transition hover:bg-[#1E40AF]"
                  >
                    Coba Pesan Sekarang
                  </button>
                </div>
                <p className="mt-3 text-center text-[11px] text-slate-400">
                  Peta rute OSRM + radar driver terdekat terbuka setelah masuk.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Kartu layanan ala Gojek */}
        <section id="layanan" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-14">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#1D4ED8]">Layanan kami</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight md:text-4xl">
            Satu aplikasi untuk semua perjalanan
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <article className="overflow-hidden rounded-3xl border border-blue-100 bg-white shadow-sm transition hover:shadow-xl">
              <div className="bg-[#1D4ED8] p-5 text-white">
                <p className="text-4xl">🛵</p>
                <h3 className="mt-2 text-xl font-black">RodaMotor</h3>
              </div>
              <div className="p-5">
                <p className="text-sm leading-relaxed text-slate-600">
                  Armada motor gesit anti-macet dengan tarif terjangkau dan rute belokan
                  jalan nyata OSRM.
                </p>
                <button
                  type="button"
                  onClick={handlePesan}
                  className="mt-4 w-full rounded-2xl bg-[#EFF6FF] py-2.5 text-sm font-black text-[#1D4ED8] transition hover:bg-[#1D4ED8] hover:text-white"
                >
                  Pesan RodaMotor
                </button>
              </div>
            </article>
            <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:shadow-xl">
              <div className="bg-[#0F172A] p-5 text-white">
                <p className="text-4xl">🚗</p>
                <h3 className="mt-2 text-xl font-black">RodaMobil</h3>
              </div>
              <div className="p-5">
                <p className="text-sm leading-relaxed text-slate-600">
                  Perjalanan mobil ber-AC yang nyaman untuk keluarga atau rombongan hingga
                  4 orang.
                </p>
                <button
                  type="button"
                  onClick={handlePesan}
                  className="mt-4 w-full rounded-2xl bg-[#0F172A] py-2.5 text-sm font-black text-white transition hover:bg-black"
                >
                  Pesan RodaMobil
                </button>
              </div>
            </article>
            <article className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm transition hover:shadow-xl">
              <div className="bg-emerald-600 p-5 text-white">
                <p className="text-4xl">🏦</p>
                <h3 className="mt-2 text-xl font-black">Bayar Transfer</h3>
              </div>
              <div id="transfer" className="scroll-mt-24 p-5">
                <p className="text-sm leading-relaxed text-slate-600">
                  Transfer langsung ke rekening driver — 100% tarif masuk ke driver,
                  tanpa potongan platform. Verifikasi manual oleh driver.
                </p>
                <button
                  type="button"
                  onClick={handlePesan}
                  className="mt-4 w-full rounded-2xl bg-emerald-50 py-2.5 text-sm font-black text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                >
                  Mulai Perjalanan
                </button>
              </div>
            </article>
          </div>
        </section>

        {/* CTA mitra */}
        <section id="mitra" className="scroll-mt-24 bg-[#0F172A]">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 text-white md:flex-row md:items-center">
            <div className="flex-1">
              <h2 className="text-2xl font-black tracking-tight md:text-4xl">
                Punya motor atau mobil? Hasilkan cuan bersama RODAKU.
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
                Daftar sebagai Mitra Driver, terima pesanan real-time dari dashboard
                khusus, dan pantau penghasilan Anda.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleMitra}
                className="rounded-2xl bg-[#1D4ED8] px-6 py-3.5 text-sm font-black text-white shadow-xl transition hover:bg-[#1E40AF]"
              >
                Gabung Jadi Mitra Driver →
              </button>
              <Link
                href="/driver"
                className="rounded-2xl border border-white/20 px-6 py-3.5 text-center text-sm font-bold text-white transition hover:bg-white/10"
              >
                Buka Portal Driver
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 text-sm text-slate-500 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <RodakuLogo size="sm" variant="dark" />
            <span className="text-slate-400">© 2026 · Perjalanan cepat & hemat</span>
          </div>
          <nav className="flex flex-wrap gap-5 text-xs font-bold" aria-label="Tautan footer">
            <a href="#beranda" className="hover:text-[#1D4ED8]">Beranda</a>
            <a href="#layanan" className="hover:text-[#1D4ED8]">Layanan</a>
            <a href="#mitra" className="hover:text-[#1D4ED8]">Mitra Driver</a>
            <a href="#transfer" className="hover:text-[#1D4ED8]">Bayar Transfer</a>
          </nav>
        </div>
      </footer>

      {/* Modal masuk: Pelanggan vs Mitra Driver */}
      {authOpen && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Masuk atau daftar RODAKU"
          onClick={() => setAuthOpen(false)}
        >
          <div
            className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setAuthOpen(false)}
              aria-label="Tutup"
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
            >
              ✕
            </button>
            <AuthPanel
              key={authTab}
              initialRole={authTab}
              onAuthenticated={handleAuthenticated}
            />
          </div>
        </div>
      )}
    </div>
  );
}
