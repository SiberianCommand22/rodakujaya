"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type AuthUser } from "@/components/AuthPanel";
import PortalLogin from "@/components/PortalLogin";
import AdminWithdrawals from "@/components/AdminWithdrawals";
import RodakuLogo from "@/components/RodakuLogo";
import { portalLogout } from "@/lib/sessionClient";
import { formatIDR, formatKm } from "@/lib/utils";

const AdminFleetMap = dynamic(() => import("@/components/AdminFleetMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#EFF6FF] text-sm text-[#1D4ED8]">
      Memuat peta armada...
    </div>
  ),
});

type DriverRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string;
  plateNumber: string;
  vehicleType: string;
  totalTrips: number;
  rating: number;
  isOnline: boolean;
  isBlocked: boolean;
  onTrip: boolean;
  lastLat: number | null;
  lastLng: number | null;
};

type LiveOrder = {
  id: string;
  status: string;
  fare: number;
  distanceKm: number;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  customerName: string;
  driverName: string | null;
  createdAt: string;
};

type Overview = {
  stats: {
    ordersToday: number;
    onlineDrivers: number;
    turnover: number;
    commission: number;
    qrisPaid?: number;
    qrisTurnover?: number;
    qrisCommission?: number;
    driverPayout?: number;
  };
  drivers: DriverRow[];
  liveOrders: LiveOrder[];
};

export default function AdminDashboard({ initialUser }: { initialUser: AuthUser | null }) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/overview");
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? json?.error ?? "Gagal memuat data admin");
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data admin");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || user.role !== "ADMIN") return;
    // Muat awal via macrotask agar tidak setState sinkron di body effect,
    // lalu polling tiap 10 detik untuk data live.
    const initial = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [user, load]);

  async function toggleDriver(driver: DriverRow) {
    setBusyId(driver.id);
    try {
      const res = await fetch("/api/admin/drivers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: driver.id,
          action: driver.isBlocked ? "activate" : "block",
        }),
      });
      if (!res.ok) throw new Error("Gagal mengubah status driver");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah status driver");
    } finally {
      setBusyId(null);
    }
  }

  async function handleLogout() {
    await portalLogout("ADMIN");
    setUser(null);
    setData(null);
  }

  async function emergencyCancel(orderId: string) {
    if (!confirm("Batalkan darurat pesanan ini?")) return;
    setBusyId(orderId);
    try {
      const res = await fetch("/api/admin/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) throw new Error("Gagal membatalkan pesanan");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membatalkan pesanan");
    } finally {
      setBusyId(null);
    }
  }

  // Belum login atau sesi bukan admin → akses inti rahasia (dark slate navy).
  if (!user || user.role !== "ADMIN") {
    return (
      <PortalLogin
        portal="admin"
        currentUser={user}
        onAuthenticated={setUser}
        onLogout={handleLogout}
      />
    );
  }

  const stats = [
    { label: "Pesanan Hari Ini", value: String(data?.stats.ordersToday ?? "-"), icon: "📦" },
    { label: "Driver Online", value: String(data?.stats.onlineDrivers ?? "-"), icon: "🛵" },
    { label: "Perputaran Uang", value: data ? formatIDR(data.stats.turnover) : "-", icon: "💰" },
    { label: "Komisi Platform 20%", value: data ? formatIDR(data.stats.commission) : "-", icon: "🏦" },
    { label: "QRIS Lunas Hari Ini", value: data?.stats.qrisPaid !== undefined ? String(data.stats.qrisPaid) : "-", icon: "🧾" },
    { label: "Omzet QRIS Lunas", value: data?.stats.qrisTurnover !== undefined ? formatIDR(data.stats.qrisTurnover) : "-", icon: "💳" },
    { label: "Komisi QRIS 20%", value: data?.stats.qrisCommission !== undefined ? formatIDR(data.stats.qrisCommission) : "-", icon: "🏛" },
    { label: "Bagi Hasil Driver 80%", value: data?.stats.driverPayout !== undefined ? formatIDR(data.stats.driverPayout) : "-", icon: "🤝" },
  ];

  return (
    <div className="min-h-dvh bg-[#F8FAFC]">
      <header className="sticky top-0 z-[1200] bg-[#0F172A] px-4 py-3 text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <RodakuLogo size="sm" variant="light" />
          <div>
            <p className="text-sm font-black leading-tight">Admin</p>
            <p className="text-[11px] text-slate-300">Pusat kendali operasional • {user.name}</p>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={load}
              className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-bold hover:bg-white/20"
            >
              {loading ? "Memuat..." : "↻ Refresh"}
            </button>
            <Link href="/" className="rounded-xl bg-[#1D4ED8] px-3 py-1.5 text-xs font-bold">
              Pelanggan
            </Link>
            <Link href="/driver" className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-bold">
              Driver
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

      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
        {error && (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        {/* Dashboard ringkasan */}
        <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-blue-100">
              <p className="text-xl">{s.icon}</p>
              <p className="mt-1 truncate text-lg font-black text-[#0F172A]">{s.value}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</p>
            </div>
          ))}
        </section>

        {/* Live fleet monitoring map */}
        <AdminWithdrawals />
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-blue-100">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-black text-[#0F172A]">🗺 Live Fleet Monitoring</h2>
            <div className="flex gap-3 text-[11px] font-semibold text-slate-500">
              <span>🔵 Stanby</span>
              <span>🔴 On-trip</span>
              <span>⚪ Offline</span>
            </div>
          </div>
          <div className="h-[320px]">
            <AdminFleetMap drivers={data?.drivers ?? []} />
          </div>
        </section>

        {/* Manajemen & verifikasi driver */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-blue-100">
          <h2 className="px-4 pt-4 text-sm font-black text-[#0F172A]">
            👥 Manajemen & Verifikasi Driver ({data?.drivers.length ?? 0})
          </h2>
          <div className="overflow-x-auto p-2">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="px-3 py-2">Nama</th>
                  <th className="px-3 py-2">No Telp</th>
                  <th className="px-3 py-2">Plat Nomor</th>
                  <th className="px-3 py-2">Total Trip</th>
                  <th className="px-3 py-2">Rating</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(data?.drivers ?? []).map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-bold text-[#0F172A]">{d.name}</td>
                    <td className="px-3 py-2">{d.phone ?? "-"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-md bg-[#0F172A] px-2 py-1 font-black text-white">{d.plateNumber}</span>
                    </td>
                    <td className="px-3 py-2">{d.totalTrips}</td>
                    <td className="px-3 py-2">★ {d.rating.toFixed(1)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 font-bold ${
                          d.isBlocked
                            ? "bg-red-600 text-white"
                            : d.onTrip
                              ? "bg-red-100 text-red-700"
                              : d.isOnline
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {d.isBlocked ? "Diblokir" : d.onTrip ? "On-trip" : d.isOnline ? "Online" : "Offline"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={busyId === d.id}
                        onClick={() => toggleDriver(d)}
                        className={`rounded-xl px-3 py-1.5 font-bold ${
                          d.isBlocked ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-red-50 text-red-600 hover:bg-red-100"
                        }`}
                      >
                        {d.isBlocked ? "Aktifkan" : "Blokir"}
                      </button>
                    </td>
                  </tr>
                ))}
                {(!data || data.drivers.length === 0) && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                      Belum ada driver terdaftar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Transaksi real-time */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-blue-100">
          <h2 className="px-4 pt-4 text-sm font-black text-[#0F172A]">
            ⚡ Transaksi Real-time ({data?.liveOrders.length ?? 0} berjalan)
          </h2>
          <div className="overflow-x-auto p-2">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Rute</th>
                  <th className="px-3 py-2">Pelanggan → Driver</th>
                  <th className="px-3 py-2">Tarif</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(data?.liveOrders ?? []).map((o) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono">{o.id.slice(0, 8)}…</td>
                    <td className="max-w-[280px] px-3 py-2">
                      <p className="truncate">📍 {o.pickupAddress ?? "-"}</p>
                      <p className="truncate text-slate-500">🏁 {o.dropoffAddress ?? "-"}</p>
                      <p className="text-slate-400">{formatKm(o.distanceKm)}</p>
                    </td>
                    <td className="px-3 py-2">
                      {o.customerName} → {o.driverName ?? <span className="text-amber-600">mencari driver…</span>}
                    </td>
                    <td className="px-3 py-2 font-bold text-[#1D4ED8]">{formatIDR(o.fare)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-bold text-blue-800">{o.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => emergencyCancel(o.id)}
                        className="rounded-xl bg-red-600 px-3 py-1.5 font-bold text-white hover:bg-red-700"
                      >
                        Batal Darurat
                      </button>
                    </td>
                  </tr>
                ))}
                {(!data || data.liveOrders.length === 0) && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                      Tidak ada order berjalan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
