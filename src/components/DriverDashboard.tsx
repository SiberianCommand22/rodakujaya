"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AuthUser } from "@/components/AuthPanel";
import PortalLogin from "@/components/PortalLogin";
import ChatDrawer from "@/components/ChatDrawer";
import RodakuLogo from "@/components/RodakuLogo";
import { portalLogout } from "@/lib/sessionClient";
import { SOCKET_EVENTS, getSocket } from "@/lib/socket";
import {
  isAudioSupported,
  playOrderAlert,
  primeAudio,
  stopOrderAlert,
} from "@/lib/audio";
import {
  FARE_MATRIX,
  formatIDR,
  formatKm,
  haversineDistanceKm,
  type LatLng,
  type OrderStatus,
} from "@/lib/utils";

const Map = dynamic(() => import("@/components/Map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#EFF6FF] text-sm text-[#1D4ED8]">
      Memuat peta...
    </div>
  ),
});

type IncomingOrder = {
  id: string;
  vehicleType: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress?: string | null;
  dropoffLat: number;
  dropoffLng: number;
  dropoffAddress?: string | null;
  distanceKm: number;
  fare: number;
  driverNote?: string | null;
  createdAt?: string;
};

/** Full order details for "Hasil Pemesanan" receipt. */
type OrderReceipt = IncomingOrder & {
  updatedAt: string;
  customer: { name: string } | null;
  driver: { plateNumber: string; user: { name: string } } | null;
};

const TRIP_STEPS: { status: OrderStatus; label: string; hint: string }[] = [
  { status: "PICKING_UP", label: "Saya Sudah Tiba di Lokasi Jemput", hint: "Langkah 1 • Konfirmasi tiba" },
  { status: "ON_TRIP", label: "Mulai Perjalanan Bersama Pelanggan", hint: "Langkah 2 • Mulai argo" },
  { status: "COMPLETED", label: "Sudah Sampai Tujuan", hint: "Langkah 3 • Akhiri perjalanan" },
];

const STEP_ORDER: OrderStatus[] = ["ACCEPTED", "PICKING_UP", "ON_TRIP", "COMPLETED"];

function stepIndex(status: OrderStatus | null): number {
  if (!status) return -1;
  return STEP_ORDER.indexOf(status);
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  SEARCHING: "Mencari Driver",
  ACCEPTED: "Pesanan Diterima",
  PICKING_UP: "Menuju Lokasi Jemput",
  ON_TRIP: "Dalam Perjalanan",
  AWAITING_PAYMENT: "Menunggu Pembayaran",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};



export default function DriverDashboard({
  initialUser,
}: {
  initialUser: AuthUser | null;
}) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [online, setOnline] = useState(false);
  const [incoming, setIncoming] = useState<IncomingOrder | null>(null);
  const [available, setAvailable] = useState<IncomingOrder[]>([]);
  const [acceptBusy, setAcceptBusy] = useState<string | null>(null);
  const [active, setActive] = useState<IncomingOrder | null>(null);
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [selfPoint, setSelfPoint] = useState<LatLng | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(15);
  const [driverHeading, setDriverHeading] = useState<number>(0);
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);

  const posRef = useRef<LatLng | null>(null);
  const activeRef = useRef<IncomingOrder | null>(null);
  const watchRef = useRef<number | null>(null);
  const legStartRef = useRef<number>(0);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Unlock Web Audio on the first gesture so alerts can play later.
  useEffect(() => {
    const unlock = () => void primeAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    return () => {
      stopOrderAlert();
      if (watchRef.current !== null) {
        navigator.geolocation?.clearWatch(watchRef.current);
      }
    };
  }, []);

  // Recover an in-progress order (and online flag) after a refresh or restart.
  const driverId = user?.driver?.id ?? null;

  useEffect(() => {
    if (!driverId) return;

    let cancelled = false;

    fetch("/api/driver/active")
      .then(async (res) => (res.ok ? await res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;

        // Sinkronkan flag blokir terbaru: bila admin menangguhkan di tengah
        // sesi, konsol langsung beralih ke layar blokir.
        if (data.driver?.isBlocked) {
          setUser((prev) =>
            prev?.driver ? { ...prev, driver: { ...prev.driver, isBlocked: true } } : prev,
          );
          setOnline(false);
          return;
        }

        if (data.driver?.isOnline) setOnline(true);
        if (!data.order) return;

        setActive(data.order);
        setStatus(data.order.status);

        // Place the marker on the last fix persisted in SQLite, so the map is
        // correct until live telemetry resumes.
        if (
          typeof data.driver?.lastLat === "number" &&
          typeof data.driver?.lastLng === "number"
        ) {
          const restored = {
            lat: data.driver.lastLat,
            lng: data.driver.lastLng,
          };
          posRef.current = restored;
          setSelfPoint(restored);
        }

        const socket = getSocket();
        if (!socket.connected) socket.connect();
        socket.emit(SOCKET_EVENTS.TRACK_ORDER, data.order.id);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [driverId]);

  function publish(point: LatLng, heading?: number) {
    const order = activeRef.current;
    if (!order) return;
    posRef.current = point;
    setSelfPoint(point);
    getSocket().emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, {
      orderId: order.id,
      driverId: user?.driver?.id ?? "driver",
      lat: point.lat,
      lng: point.lng,
      heading: heading ?? 0,
    });
  }

  // Incoming order notifications.
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const onOrderNew = (order: IncomingOrder) => {
      if (!online) return;
      setIncoming(order);
      setAvailable((prev) =>
        prev.some((o) => o.id === order.id) ? prev : [order, ...prev].slice(0, 20),
      );
      setCountdown(15);
      if (soundOn && isAudioSupported()) playOrderAlert();
    };

    socket.on(SOCKET_EVENTS.ORDER_CREATED, onOrderNew);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_CREATED, onOrderNew);
    };
  }, [online, soundOn]);

  // Jaring pengaman Socket.io: polling daftar SEARCHING tiap 3 detik saat
  // online & tanpa order aktif, agar pesanan 100% muncul (anti-nyangkut).
  useEffect(() => {
    if (!online || active || !user?.driver) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/driver/orders/available");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { orders?: (IncomingOrder & { createdAt?: string })[] };
        if (!cancelled && Array.isArray(data.orders)) {
          // Bersihkan antrean kadaluarsa (>10 menit) agar tidak menumpuk.
          const fresh_cutoff = Date.now() - 10 * 60_000;
          data.orders = data.orders.filter((o) => {
            if (!o.createdAt) return true;
            return new Date(o.createdAt).getTime() >= fresh_cutoff;
          });
          setAvailable((prev) => {
            // Pertahankan highlight incoming bila masih menunggu.
            const ids = new Set(data.orders!.map((o) => o.id));
            const kept = prev.filter((o) => ids.has(o.id) || (incoming?.id === o.id));
            const fresh = data.orders!.filter((o) => !kept.some((k) => k.id === o.id));
            return [...fresh, ...kept].slice(0, 20);
          });
        }
      } catch {
        /* best-effort */
      }
    }
    const initial = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [online, active, user?.driver, incoming]);

  // Batas 15 detik untuk konfirmasi pesanan masuk; hangus otomatis.
  // countdown direset di handler onOrderNew, jadi effect ini hanya menjalankan timer.
  useEffect(() => {
    if (!incoming) return;
    const orderId = incoming.id;
    const interval = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    const expiry = setTimeout(() => {
      stopOrderAlert();
      setIncoming((prev) => (prev?.id === orderId ? null : prev));
      setCountdown(0);
      setError("Pesanan hangus: tidak dikonfirmasi dalam 15 detik.");
    }, 15_000);
    return () => {
      clearInterval(interval);
      clearTimeout(expiry);
    };
  }, [incoming]);

  // Mirror the active order status + dengarkan pelunasan QRIS real-time.
  useEffect(() => {
    const socket = getSocket();
    if (!active) return;

    socket.emit(SOCKET_EVENTS.TRACK_ORDER, active.id);
    const onStatus = (payload: { orderId: string; status: OrderStatus; cancelReason?: string | null }) => {
      if (payload.orderId !== active.id) return;
      if (payload.status === "CANCELLED") {
        setActive(null);
        setStatus(null);
        posRef.current = null;
        setSelfPoint(null);
        setGpsAccuracy(null);
        setToast(
          payload.cancelReason
            ? `Pesanan dibatalkan pelanggan: ${payload.cancelReason}.`
            : "Pesanan dibatalkan pelanggan.",
        );
        return;
      }
      setStatus(payload.status);
    };
    const onPaid = (payload: { orderId: string; amount?: number }) => {
      if (payload.orderId !== active.id) return;
      const amount = typeof payload.amount === "number" ? payload.amount : active.fare;
      setToast(
        `💰 Pembayaran lunas ${formatIDR(amount)} — terima kasih!`,
      );
    };
    socket.on(SOCKET_EVENTS.ORDER_STATUS_UPDATE, onStatus);
    socket.on(SOCKET_EVENTS.PAYMENT_SETTLED, onPaid);
    return () => {
      socket.off(SOCKET_EVENTS.ORDER_STATUS_UPDATE, onStatus);
      socket.off(SOCKET_EVENTS.PAYMENT_SETTLED, onPaid);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Telemetri GPS hardware asli: aktif saat driver ONLINE dan memegang order
  // aktif, sehingga sensor GPS fisik HP pengemudi mengalir ke room order.
  const tracking = online && Boolean(active);
  const streaming = status === "PICKING_UP" || status === "ON_TRIP";
  const gpsSupported =
    typeof navigator !== "undefined" && Boolean(navigator.geolocation);

  useEffect(() => {
    if (!tracking || !gpsSupported) return;

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGpsAccuracy(
          typeof pos.coords.accuracy === "number" && Number.isFinite(pos.coords.accuracy)
            ? Math.round(pos.coords.accuracy)
            : null,
        );
        setGpsNote(null);
        publish(
          point,
          typeof pos.coords.heading === "number" && !Number.isNaN(pos.coords.heading)
            ? pos.coords.heading
            : undefined,
        );
      },
      (err) => {
        setGpsAccuracy(null);
        setGpsNote(
          err.code === err.PERMISSION_DENIED
            ? "Izin lokasi ditolak. Aktifkan izin lokasi agar pelanggan melihat posisi Anda."
            : "Sinyal GPS tidak tersedia. Pastikan Anda di area terbuka.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );

    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, active?.id]);

  // Awal kaki perjalanan baru → jam simulasi di-nol-kan.
  useEffect(() => {
    legStartRef.current = Date.now();
  }, [status, active?.id]);

  /**
   * Auto-Drive Engine ala Gojek/GoCar: saat GPS hardware tidak tersedia
   * (laptop/desktop), ikon motor/mobil digerakkan otomatis menyusuri garis
   * jalan OSRM setiap 1 detik.
   * - ACCEPTED/PICKING_UP: start 400–800 m dari titik jemput → ke jemput.
   * - ON_TRIP: jemput → tujuan menyusuri garis biru.
   * Setiap langkah memancarkan `driver:location_update` (lat, lng, heading)
   * sehingga peta pelanggan melihat kendaraan mendekat + ETA mengecil.
   * Begitu fix GPS hardware tiba, hardware selalu menang (efek ini berhenti).
   */
  useEffect(() => {
    if (!tracking || !active || gpsAccuracy !== null) return;
    if (status !== "ACCEPTED" && status !== "PICKING_UP" && status !== "ON_TRIP") return;
    const order = active;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    function bearing(a: LatLng, b: LatLng): number {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const toDeg = (r: number) => (r * 180) / Math.PI;
      const dLng = toRad(b.lng - a.lng);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x =
        Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    async function start() {
      try {
        // Titik awal 400–800 m dari jemput (±0.005° ≈ 550 m) bila belum ada fix.
        const from =
          status === "ON_TRIP" || !posRef.current
            ? status === "ON_TRIP"
              ? { lat: order.pickupLat, lng: order.pickupLng }
              : { lat: order.pickupLat + 0.005, lng: order.pickupLng + 0.004 }
            : posRef.current;
        const to =
          status === "ON_TRIP"
            ? { lat: order.dropoffLat, lng: order.dropoffLng }
            : { lat: order.pickupLat, lng: order.pickupLng };
        const params = new URLSearchParams({
          pickupLat: String(from.lat),
          pickupLng: String(from.lng),
          dropLat: String(to.lat),
          dropLng: String(to.lng),
        });
        const res = await fetch(`/api/routing?${params}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          geometry?: { coordinates: [number, number][] };
          durationMinutes?: number;
        };
        const coords = data.geometry?.coordinates ?? [];
        if (coords.length < 2 || cancelled) return;
        const line: LatLng[] = coords.map(([lng, lat]) => ({ lat, lng }));
        // Demo yang hidup: tempuh kaki rute dalam ~60–90 detik agar gerakan
        // 1-detik terlihat jelas di layar pelanggan.
        const totalMs = Math.min(
          90_000,
          Math.max(45_000, (data.durationMinutes ?? 3) * 60_000),
        );
        const t0 = legStartRef.current;

        // Segmen kumulatif agar kecepatan seragam di tiap ruas jalan.
        const segLen: number[] = [0];
        for (let i = 1; i < line.length; i++) {
          segLen.push(segLen[i - 1]! + haversineDistanceKm(line[i - 1]!, line[i]!));
        }
        const totalKm = segLen[segLen.length - 1]! || 1;

        const step = () => {
          if (cancelled) return;
          const frac = Math.min(1, (Date.now() - t0) / totalMs);
          const target = frac * totalKm;
          let i = 1;
          while (i < segLen.length - 1 && segLen[i]! < target) i++;
          const a = line[i - 1]!;
          const b = line[i]!;
          const span = segLen[i]! - segLen[i - 1]! || 1;
          const f = Math.min(1, Math.max(0, (target - segLen[i - 1]!) / span));
          const point = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
          const head = bearing(a, b);
          posRef.current = point;
          setSelfPoint(point);
          setDriverHeading(head);
          getSocket().emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, {
            orderId: order.id,
            driverId: user?.driver?.id ?? "driver",
            lat: point.lat,
            lng: point.lng,
            heading: head,
          });
          if (frac >= 1 && timer) {
            clearInterval(timer);
            timer = null;
          }
        };
        step();
        // Real-time setiap 1 detik menyusuri garis jalan.
        timer = setInterval(step, 1000);
      } catch {
        /* best-effort: peta pelanggan tetap menunggu fix GPS */
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, active?.id, status, gpsAccuracy]);

  async function setDriverOnline(next: boolean) {
    setOnline(next);
    if (!user?.driver) return;

    try {
      const res = await fetch("/api/driver/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isOnline: next }),
      });
      if (!res.ok) throw new Error("Gagal memperbarui status");
    } catch {
      setError("Gagal memperbarui status online.");
      setOnline(!next);
    }
  }

  const advance = useCallback(
    async (nextStatus: OrderStatus) => {
      if (!active) return;
      try {
        // Send the current fix so the server persists it on every transition.
        const res = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: active.id,
            status: nextStatus,
            ...(posRef.current
              ? { lat: posRef.current.lat, lng: posRef.current.lng }
              : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message ?? "Gagal memperbarui status");

        setStatus(nextStatus);
        getSocket().emit(SOCKET_EVENTS.ORDER_STATUS_UPDATE, {
          orderId: active.id,
          status: nextStatus,
          driverId: user?.driver?.id ?? null,
          plateNumber: user?.driver?.plateNumber ?? null,
        });

        if (nextStatus === "COMPLETED") {
          // Fetch full order details for receipt (customer name, updatedAt, driver info)
          try {
            const fullRes = await fetch(`/api/orders?limit=1`);
            if (fullRes.ok) {
              const fullData = await fullRes.json();
              const completedOrder = (fullData.recent ?? []).find(
                (o: { id: string }) => o.id === active.id,
              );
              if (completedOrder) {
                setReceipt({
                  ...active,
                  updatedAt: completedOrder.updatedAt,
                  customer: completedOrder.customer ?? null,
                  driver: completedOrder.driver
                    ? {
                        plateNumber: completedOrder.driver.plateNumber,
                        user: { name: completedOrder.driver.user?.name ?? "" },
                      }
                    : null,
                });
              } else {
                setReceipt(active as OrderReceipt);
              }
            } else {
              setReceipt(active as OrderReceipt);
            }
          } catch {
            setReceipt(active as OrderReceipt);
          }
          setToast("Perjalanan selesai. Tiba di tujuan.");
          setActive(null);
          setStatus(null);
          setAvailable([]);
          posRef.current = null;
          setSelfPoint(null);
          setGpsAccuracy(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal memperbarui status");
      }
    },
    [active, user],
  );

  async function claimOrder(order: IncomingOrder) {
    stopOrderAlert();
    setAcceptBusy(order.id);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, status: "ACCEPTED" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data?.message ?? "Pesanan sudah diambil");
      }

      setActive(order);
      setStatus("ACCEPTED");
      setIncoming((prev) => (prev?.id === order.id ? null : prev));
      setAvailable((prev) => prev.filter((o) => o.id !== order.id));
      // Tempatkan kendaraan 400–800 m dari titik jemput agar Auto-Drive
      // langsung terlihat bergerak menuju jemput di kedua peta.
      const seed = { lat: order.pickupLat + 0.005, lng: order.pickupLng + 0.004 };
      posRef.current = seed;
      setSelfPoint(seed);
      setDriverHeading(0);
      // eslint-disable-next-line react-hooks/purity -- event handler, bukan render
      legStartRef.current = Date.now();

      getSocket().emit(SOCKET_EVENTS.TRACK_ORDER, order.id);
      getSocket().emit(SOCKET_EVENTS.ORDER_STATUS_UPDATE, {
        orderId: order.id,
        status: "ACCEPTED",
        driverId: user?.driver?.id ?? null,
        plateNumber: user?.driver?.plateNumber ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menerima pesanan");
      setIncoming((prev) => (prev?.id === order.id ? null : prev));
      setAvailable((prev) => prev.filter((o) => o.id !== order.id));
    } finally {
      setAcceptBusy(null);
    }
  }

  async function acceptOrder() {
    if (!incoming) return;
    await claimOrder(incoming);
  }

  function declineOrder() {
    stopOrderAlert();
    setIncoming(null);
  }

  async function handleLogout() {
    await portalLogout("DRIVER");
    stopOrderAlert();
    setUser(null);
    setOnline(false);
    setActive(null);
    setStatus(null);
    setIncoming(null);
  }

  // Belum login atau sesi bukan driver → panel khusus Portal Mitra Driver.
  if (!user || user.role !== "DRIVER" || !user.driver) {
    return (
      <PortalLogin
        portal="driver"
        currentUser={user}
        onAuthenticated={setUser}
        onLogout={handleLogout}
      />
    );
  }

  // Mitra yang ditangguhkan administrator tidak bisa memakai konsol driver.
  if (user.driver.isBlocked) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-3 bg-[#0F172A] p-6 text-center text-white">
        <p className="text-4xl">⛔</p>
        <p className="text-xl font-black">Akun Ditangguhkan</p>
        <p className="text-sm text-slate-300">
          Akun Mitra Anda sedang ditangguhkan/diblokir oleh Administrator.
          Hubungi admin RODAKU untuk pemulihan akses.
        </p>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-2xl bg-red-500 px-5 py-2.5 text-sm font-black shadow-xl"
        >
          Keluar
        </button>
      </div>
    );
  }

  const etaKm =
    selfPoint && active && streaming
      ? haversineDistanceKm(
          selfPoint,
          status === "ON_TRIP"
            ? { lat: active.dropoffLat, lng: active.dropoffLng }
            : { lat: active.pickupLat, lng: active.pickupLng },
        )
      : null;

  return (
    <div className="flex min-h-dvh flex-col bg-[#0F172A]">
      <header className="sticky top-0 z-[1200] bg-[#0F172A] px-5 py-4 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <RodakuLogo size="sm" variant="light" />
            <div>
              <p className="text-base font-bold leading-tight">{user.name}</p>
              <p className="text-xs text-slate-300">
                {user.driver.plateNumber} •{" "}
                {FARE_MATRIX[
                  user.driver.vehicleType as "RODA_MOTOR" | "RODA_MOBIL"
                ]?.label ?? user.driver.vehicleType}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                online ? "bg-emerald-500 text-white" : "bg-white/10 text-slate-300"
              }`}
            >
              {online ? "Online" : "Offline"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={online}
              aria-label="Status online"
              onClick={() => setDriverOnline(!online)}
              className={`relative h-7 w-12 rounded-full transition ${
                online ? "bg-[#1D4ED8]" : "bg-slate-600"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                  online ? "left-6" : "left-1"
                }`}
              />
            </button>
            <Link
              href="/"
              className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Pelanggan
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl bg-red-500 px-3 py-1.5 text-xs font-black text-white transition hover:bg-red-600"
            >
              Keluar
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="mx-auto mt-4 w-full max-w-6xl rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white">
          {toast}
        </div>
      )}
      {error && (
        <div className="mx-auto mt-4 w-full max-w-6xl rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white">
          {error}
        </div>
      )}
      {gpsNote && (
        <div className="mx-auto mt-4 w-full max-w-6xl rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white">
          {gpsNote}
        </div>
      )}
      {tracking && !gpsSupported && (
        <div className="mx-auto mt-4 w-full max-w-6xl rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white">
          GPS tidak didukung perangkat ini. Aktifkan layanan lokasi.
        </div>
      )}

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-4 p-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 rounded-2xl bg-white/5 p-2">
            <span
              className={`flex-1 rounded-xl px-3 py-2 text-center text-xs font-bold ${
                gpsAccuracy !== null
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-white/5 text-slate-300"
              }`}
              role="status"
            >
              {gpsAccuracy !== null
                ? `📡 GPS Akurat (Akurasi: ±${gpsAccuracy} meter)`
                : tracking
                  ? "📡 Mencari sinyal GPS…"
                  : "📡 GPS aktif saat ada pesanan"}
            </span>
            <button
              type="button"
              onClick={() => setSoundOn((s) => !s)}
              className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white"
            >
              {soundOn ? "Matikan Nada" : "Aktifkan Nada"}
            </button>
          </div>

          {!online && (
            <div className="rounded-2xl bg-white/5 p-6 text-center text-sm text-slate-300">
              Anda sedang offline. Aktifkan toggle Online untuk menerima pesanan.
            </div>
          )}

          {online && !active && (
            <div className="rounded-2xl bg-white/5 p-6 text-center text-sm text-slate-300">
              {available.length > 0
                ? `Ada ${available.length} pesanan menunggu — pilih di bawah ini.`
                : "Menunggu pesanan masuk dari pelanggan..."}
            </div>
          )}

          {online && !active && available.length > 0 && (
            <div className="rounded-2xl bg-white p-4">
              <p className="text-xs font-black uppercase tracking-wide text-[#1D4ED8]">
                📋 Pesanan Menunggu di Sekitar ({available.length})
              </p>
              <ul className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto">
                {available.map((order) => (
                  <li
                    key={order.id}
                    className="rounded-2xl border border-blue-100 bg-[#EFF6FF]/60 p-3"
                  >
                    <p className="truncate text-xs text-slate-600">
                      📍 {order.pickupAddress ?? "-"}
                    </p>
                    <p className="truncate text-xs text-slate-600">
                      🏁 {order.dropoffAddress ?? "-"}
                    </p>
                    {order.driverNote && (
                      <p className="mt-1 truncate text-[11px] text-amber-800">
                        📝 {order.driverNote}
                      </p>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-600">
                        {formatKm(order.distanceKm)} •{" "}
                        <span className="font-black text-[#1D4ED8]">{formatIDR(order.fare)}</span>
                        <span className="ml-1 font-bold text-emerald-600">
                          (+{formatIDR(order.fare)})
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={acceptBusy === order.id}
                        onClick={() => void claimOrder(order)}
                        className="shrink-0 rounded-xl bg-[#1D4ED8] px-4 py-2 text-xs font-black text-white shadow transition hover:bg-[#1E40AF] disabled:opacity-60"
                      >
                        {acceptBusy === order.id ? "…" : "Terima"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {active && (
              <div className="rounded-2xl bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#1D4ED8]">
                Pesanan Aktif
              </p>
              <h2 className="mt-1 text-lg font-bold text-[#0F172A]">
                {STATUS_LABEL[status ?? "ACCEPTED"]}
              </h2>

              <div className="mt-4 flex flex-col gap-2 text-sm">
                <p className="text-slate-600">
                  <span className="font-semibold text-[#0F172A]">Jemput:</span>{" "}
                  {active.pickupAddress ?? "-"}
                </p>
                <p className="text-slate-600">
                  <span className="font-semibold text-[#0F172A]">Tujuan:</span>{" "}
                  {active.dropoffAddress ?? "-"}
                </p>
                {active.driverNote && (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span className="font-bold">📝 Catatan pelanggan:</span>{" "}
                    {active.driverNote}
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between rounded-xl bg-[#EFF6FF] px-4 py-3 text-sm">
                <span className="text-slate-600">
                  {formatKm(active.distanceKm)} • {formatIDR(active.fare)}
                </span>
                {etaKm !== null && (
                  <span className="font-semibold text-[#1D4ED8]">
                    {formatKm(etaKm)} lagi
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-2.5 text-xs">
                <span className="font-semibold text-emerald-700">Pendapatan Anda (100%)</span>
                <span className="text-sm font-black text-emerald-700">{formatIDR(active.fare)}</span>
              </div>

              <p className="mt-3 text-center text-[11px] text-slate-400">
                {tracking
                  ? "GPS perangkat mengirim lokasi real-time ke pelanggan"
                  : "Telemetri aktif saat perjalanan dimulai"}
              </p>

              {/* Stepper perjalanan bertahap */}
              <div className="mt-4 flex flex-col gap-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Kontrol perjalanan bertahap
                </p>
                {TRIP_STEPS.map((step, i) => {
                  const current = stepIndex(status);
                  const mine = i + 1; // ACCEPTED=0 → langkah 1 = index 1
                  const done = current > mine;
                  const isNext =
                    (status === "ACCEPTED" && step.status === "PICKING_UP") ||
                    (status === "PICKING_UP" && step.status === "ON_TRIP") ||
                    (status === "ON_TRIP" && step.status === "COMPLETED");
                  return (
                    <button
                      key={step.status}
                      type="button"
                      disabled={!isNext}
                      onClick={() => advance(step.status)}
                      className={`w-full rounded-2xl py-3 text-sm font-bold shadow transition ${
                        done
                          ? "bg-emerald-100 text-emerald-700"
                          : isNext
                            ? "bg-[#1D4ED8] text-white shadow-xl hover:bg-[#1E40AF]"
                            : "cursor-not-allowed bg-slate-100 text-slate-400 shadow-none"
                      }`}
                    >
                      {done ? `✓ ${step.label}` : `${mine}. ${step.label}`}
                    </button>
                  );
                })}

                <p className="text-center text-[10px] text-slate-400">
                  Selesaikan langkah berurutan: tiba → mulai perjalanan → sudah sampai tujuan.
                </p>
              </div>
            </div>
              )}
        </div>

        <div className="min-h-[50dvh] overflow-hidden rounded-2xl">
          <Map
            pickup={
              active ? { lat: active.pickupLat, lng: active.pickupLng } : null
            }
            dropoff={
              active ? { lat: active.dropoffLat, lng: active.dropoffLng } : null
            }
            driver={selfPoint}
            vehicleType={(user.driver.vehicleType as "RODA_MOTOR" | "RODA_MOBIL") ?? "RODA_MOTOR"}
            heading={driverHeading}
            followDriver={status === "PICKING_UP" || status === "ON_TRIP" || status === "ACCEPTED"}
          />
        </div>
      </main>

{receipt && (
        (() => {
          const formatCompletionTime = (isoString?: string | null) => {
            if (!isoString) return "-";
            const date = new Date(isoString);
            return date.toLocaleString("id-ID", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          };

          return (
            <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-[#0F172A]/70 p-4 backdrop-blur-sm sm:items-center">
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Hasil Pemesanan"
                className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
              >
                {/* Header with PERJALANAN SELESAI badge */}
                <div className="relative bg-emerald-600 px-6 py-5 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100">
                        PERJALANAN SELESAI
                      </p>
                      <h2 className="mt-1 text-2xl font-bold">Hasil Pemesanan</h2>
                    </div>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                      <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-emerald-100">
                    #{receipt.id.slice(-8).toUpperCase()} · {formatCompletionTime(receipt.updatedAt)}
                  </p>
                </div>

                {/* Trip Details */}
                <div className="p-6 space-y-4">
                  {/* Driver & Customer */}
                  <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
                          <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 8v4l2 2" />
                          </svg>
                        </span>
                        <div>
                          <p className="font-semibold text-[#0F172A]">{receipt.driver?.user?.name ?? user?.name ?? "Mitra Driver"}</p>
                          <p className="text-xs text-slate-500">{receipt.driver?.plateNumber ?? user?.driver?.plateNumber ?? "-"}</p>
                        </div>
                      </div>
                      {receipt.customer && (
                        <div className="text-right">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pelanggan</p>
                          <p className="font-semibold text-[#0F172A]">{receipt.customer.name}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Route */}
                  <div className="rounded-2xl border border-blue-100 bg-[#EFF6FF] px-4 py-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                      </span>
                      <span className="font-semibold text-[#0F172A]">Jemput:</span>
                      <span className="text-slate-600 flex-1 truncate">{receipt.pickupAddress ?? "-"}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18.364 18.364A9 9 0 0 0 12 8a9 9 0 0 0-6.364 10.364" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </span>
                      <span className="font-semibold text-[#0F172A]">Tujuan:</span>
                      <span className="text-slate-600 flex-1 truncate">{receipt.dropoffAddress ?? "-"}</span>
                    </div>
                  </div>

                  {/* Stats: Distance & Fare */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Jarak</p>
                      <p className="mt-1 text-2xl font-black text-[#0F172A] tabular-nums">{formatKm(receipt.distanceKm)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total Tarif</p>
                      <p className="mt-1 text-2xl font-black text-[#1D4ED8] tabular-nums">{formatIDR(receipt.fare)}</p>
                    </div>
                  </div>

                  {/* Actions: Selesai / Pesan Kembali */}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setReceipt(null)}
                      className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                    >
                      Selesai
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReceipt(null);
                        // Refresh to get new orders
                        window.location.reload();
                      }}
                      className="flex-1 rounded-2xl bg-[#1D4ED8] py-3 text-sm font-bold text-white shadow-xl transition hover:bg-[#1E40AF]"
                    >
                      Pesan Kembali
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()
      )}

<ChatDrawer
 key={active?.id ?? "chat-none"}
        orderId={active?.id ?? null}
    status={status}
   selfId={user?.id ?? null}
  selfName={user?.name ?? ""}
        selfRole="DRIVER"
      />

      {incoming && (
        <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-[#0F172A]/70 p-4 backdrop-blur-sm sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Pesanan masuk"
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-[#0F172A]">🔔 Pesanan Masuk!</h2>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                ⏱ {countdown} dtk
              </span>
            </div>
            {/* Countdown bar 15 detik */}
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${countdown <= 5 ? "bg-red-500" : "bg-[#1D4ED8]"}`}
                style={{ width: `${(countdown / 15) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-center text-[11px] font-semibold text-slate-500">
              Konfirmasi dalam {countdown} detik atau pesanan hangus • 🔊 nada peringatan berbunyi
            </p>

            <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-[#EFF6FF] p-4 text-sm">
              <p className="text-slate-700">
                <span className="font-bold text-[#0F172A]">📍 Jemput:</span>{" "}
                {incoming.pickupAddress ?? "-"}
              </p>
              <p className="text-center font-black text-[#1D4ED8]">↓ antar ke ↓</p>
              <p className="text-slate-700">
                <span className="font-bold text-[#0F172A]">🏁 Antar:</span>{" "}
                {incoming.dropoffAddress ?? "-"}
              </p>
              {incoming.driverNote && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <span className="font-bold">📝 Catatan:</span> {incoming.driverNote}
                </p>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-blue-100 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Jarak {formatKm(incoming.distanceKm)} • Tarif</span>
                <span className="text-xl font-black text-[#1D4ED8]">{formatIDR(incoming.fare)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-dashed border-blue-100 pt-2">
                <span className="text-xs font-semibold text-emerald-700">Pendapatan Anda (100%)</span>
                <span className="font-black text-emerald-600">{formatIDR(incoming.fare)}</span>
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={declineOrder}
                className="flex-1 rounded-2xl border-2 border-red-200 py-3 text-sm font-bold text-red-600 transition hover:bg-red-50"
              >
                Tolak
              </button>
              <button
                type="button"
                onClick={acceptOrder}
                className="flex-[2] rounded-2xl bg-[#1D4ED8] py-3 text-sm font-black text-white shadow-xl transition hover:bg-[#1E40AF]"
              >
                Terima ({countdown})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}