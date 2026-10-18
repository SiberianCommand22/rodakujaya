"use client";

import { useEffect, useState } from "react";
import { formatIDR, type OrderStatus } from "@/lib/utils";

export type HistoryOrder = {
  id: string;
  status: OrderStatus;
  vehicleType: string;
  distanceKm: number;
  fare: number;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  createdAt: string;
  driver: { plateNumber: string } | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  SEARCHING: "Mencari Driver",
  ACCEPTED: "Driver Diterima",
  PICKING_UP: "Driver Menuju Lokasi",
  ON_TRIP: "Dalam Perjalanan",
  AWAITING_PAYMENT: "Menunggu Pembayaran",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
};

const TONE: Record<OrderStatus, string> = {
  SEARCHING: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-blue-100 text-blue-800",
  PICKING_UP: "bg-blue-100 text-blue-800",
  ON_TRIP: "bg-blue-100 text-blue-800",
  AWAITING_PAYMENT: "bg-violet-100 text-violet-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-red-100 text-red-800",
};

type DrawerState =
  | { phase: "loading" }
  | { phase: "ready"; orders: HistoryOrder[] }
  | { phase: "error"; message: string };

export default function OrderHistoryDrawer({ open, onClose }: Props) {
  const [state, setState] = useState<DrawerState>({ phase: "loading" });

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    fetch("/api/orders?limit=25")
      .then(async (res) => {
        if (!res.ok) throw new Error("Gagal memuat riwayat");
        return (await res.json()) as { recent: HistoryOrder[] };
      })
      .then((data) => {
        if (!cancelled) setState({ phase: "ready", orders: data.recent });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ phase: "error", message: "Gagal memuat riwayat pesanan." });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const loading = state.phase === "loading";
  const orders = state.phase === "ready" ? state.orders : [];
  const error = state.phase === "error" ? state.message : null;

  return (
    <div className="fixed inset-0 z-[2000] flex justify-end">
      <button
        type="button"
        aria-label="Tutup riwayat"
        onClick={onClose}
        className="absolute inset-0 bg-[#0F172A]/50 backdrop-blur-sm"
      />

      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-blue-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#0F172A]">Riwayat Pesanan</h2>
            <p className="text-xs text-slate-500">
              {orders.length} transaksi terakhir
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-[#EFF6FF] px-3 py-1.5 text-sm font-semibold text-[#1D4ED8]"
          >
            Tutup
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <p className="py-10 text-center text-sm text-slate-400">Memuat...</p>
          )}
          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          {!loading && !error && orders.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-400">
              Belum ada pesanan.
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {orders.map((order) => (
              <li
                key={order.id}
                className="rounded-2xl border border-blue-100 bg-[#EFF6FF] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONE[order.status]}`}
                  >
                    {STATUS_LABEL[order.status]}
                  </span>
                  <span className="text-xs font-bold text-[#1D4ED8]">
                    {formatIDR(order.fare)}
                  </span>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-slate-600">
                  <span className="font-semibold text-[#0F172A]">Jemput:</span>{" "}
                  {order.pickupAddress ?? "-"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  <span className="font-semibold text-[#0F172A]">Tujuan:</span>{" "}
                  {order.dropoffAddress ?? "-"}
                </p>

                <div className="mt-3 flex items-center justify-between border-t border-white pt-2 text-[11px] text-slate-500">
                  <span>{order.distanceKm.toFixed(2)} km</span>
                  <span>#{order.id.slice(-6).toUpperCase()}</span>
                  <span>
                    {new Date(order.createdAt).toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}