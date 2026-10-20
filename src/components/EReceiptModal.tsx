"use client";

import { useEffect } from "react";

import RodakuLogo from "@/components/RodakuLogo";
import { formatIDR, formatKm, type OrderStatus } from "@/lib/utils";

export type EReceiptData = {
  orderId: string;
  status: OrderStatus;
  vehicleType?: string | null;
  distanceKm?: number | null;
  fare: number;
  discount?: number | null;
  promoCode?: string | null;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  driverName?: string | null;
  plateNumber?: string | null;
  customerName?: string | null;
  paymentStatus?: string | null;
  paidAt?: string | null;
};

type Props = {
  open: boolean;
  receipt: EReceiptData | null;
  onClose: () => void;
};

export default function EReceiptModal({ open, receipt, onClose }: Props) {
  // Esc menutup struk, konsisten dengan modal lain (WCAG 2.1.2 "No Keyboard Trap").
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || !receipt) return null;

  const paid =
    receipt.paymentStatus === "PAID" ||
    (receipt.paymentStatus == null && receipt.status === "COMPLETED");
  const settledAt = receipt.completedAt ?? receipt.paidAt ?? receipt.createdAt ?? null;
  const dateLabel = settledAt
    ? new Date(settledAt).toLocaleString("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";
  const vehicleLabel = receipt.vehicleType === "RODA_MOBIL" ? "RodaMobil" : "RodaMotor";
  const discount = Math.max(0, receipt.discount ?? 0);
  const grossFare = receipt.fare + discount;
  const distanceKm =
    typeof receipt.distanceKm === "number" && Number.isFinite(receipt.distanceKm)
      ? receipt.distanceKm
      : null;
  const driverName = receipt.driverName?.trim() || "Mitra Driver";
  const plateNumber = receipt.plateNumber?.trim() || "-";

  return (
    <div className="fixed inset-0 z-[2500] flex items-end justify-center bg-[#0F172A]/70 backdrop-blur-sm sm:items-center print:static print:bg-transparent">
      <button
        type="button"
        aria-label="Tutup struk"
        onClick={onClose}
        className="absolute inset-0 print:hidden"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Struk elektronik"
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white/95 shadow-2xl backdrop-blur-md sm:rounded-3xl print:max-h-none print:max-w-none print:overflow-visible print:rounded-none print:bg-white print:shadow-none"
      >
        <div className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
          {/* Header hijau ala e-wallet: logo + badge status + total */}
          <div className="bg-emerald-600 px-5 pb-4 pt-3 text-white print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]">
            <span
              className="mx-auto mb-2 block h-1.5 w-12 rounded-full bg-white/40 sm:hidden print:hidden"
              aria-hidden
            />
            <div className="flex items-center justify-between gap-3">
              <RodakuLogo size="sm" variant="light" />
              <span
                className={`rounded-full px-3 py-1 text-[11px] font-black ${
                  paid ? "bg-white/20 text-white" : "bg-amber-400 text-amber-950"
                }`}
              >
                {paid ? "LUNAS" : "MENUNGGU KONFIRMASI"}
              </span>
            </div>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-100">
              Struk Elektronik · E-Receipt
            </p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] text-emerald-100">
                  {paid ? "Total Dibayar" : "Total Tagihan"}
                </p>
                <p className="text-3xl font-black tabular-nums">{formatIDR(receipt.fare)}</p>
              </div>
              <p className="text-right text-[11px] leading-relaxed text-emerald-100">
                #{receipt.orderId.slice(-8).toUpperCase()}
                <br />
                {dateLabel}
              </p>
            </div>
          </div>

          <div className="space-y-3 px-5 py-4">
            {/* Driver & pelanggan */}
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-sm font-black text-[#1D4ED8]">
                  {driverName.charAt(0).toUpperCase()}
                </span>
                <div>
                  <p className="text-sm font-bold text-[#0F172A]">{driverName}</p>
                  <p className="text-xs text-slate-500">
                    {plateNumber} · {vehicleLabel}
                  </p>
                </div>
              </div>
              {receipt.customerName && (
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Pelanggan
                  </p>
                  <p className="text-xs font-bold text-[#0F172A]">{receipt.customerName}</p>
                </div>
              )}
            </div>

            {/* Rute: titik hijau jemput, pin merah tujuan */}
            <div className="rounded-2xl border border-blue-100 bg-[#EFF6FF] px-4 py-3">
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500"
                  aria-hidden
                />
                <span className="font-semibold text-[#0F172A]">Jemput:</span>
                <span className="flex-1 truncate text-slate-600">
                  {receipt.pickupAddress ?? "-"}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 shrink-0 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="font-semibold text-[#0F172A]">Tujuan:</span>
                <span className="flex-1 truncate text-slate-600">
                  {receipt.dropoffAddress ?? "-"}
                </span>
              </div>
            </div>

            {/* Rincian biaya */}
            <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Rincian Biaya
              </p>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-600">
                <span>Tarif Pokok ({vehicleLabel})</span>
                <span className="tabular-nums">{formatIDR(grossFare)}</span>
              </div>
              {discount > 0 && (
                <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-emerald-600">
                  <span>
                    Potongan Promo{receipt.promoCode ? ` (${receipt.promoCode})` : ""}
                  </span>
                  <span className="tabular-nums">−{formatIDR(discount)}</span>
                </div>
              )}
              <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-600">
                <span>Jarak Tempuh</span>
                <span className="tabular-nums">
                  {distanceKm !== null ? formatKm(distanceKm) : "-"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-slate-600">
                <span>Komisi RODAKU</span>
                <span className="font-bold tabular-nums text-emerald-600">Rp 0</span>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-dashed border-slate-200 pt-2.5">
                <span className="text-xs font-black text-[#0F172A]">
                  {paid ? "Total Dibayar" : "Total Tagihan"}
                </span>
                <span className="text-lg font-black tabular-nums text-[#1D4ED8]">
                  {formatIDR(receipt.fare)}
                </span>
              </div>
            </div>

            {/* Status pembayaran */}
            <div
              className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-xs ${
                paid ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {paid ? (
                <svg
                  viewBox="0 0 24 24"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4l2 2" />
                </svg>
              )}
              <p className="font-semibold leading-relaxed">
                Pembayaran Langsung (P2P Direct Transfer) -{" "}
                {paid ? "Terkonfirmasi" : "Menunggu konfirmasi driver"}
              </p>
            </div>
          </div>
        </div>

        {/* Aksi cetak struk */}
        <div className="flex gap-3 border-t border-slate-100 bg-white/90 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[52px] flex-1 rounded-2xl border border-slate-200 text-sm font-bold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[52px] flex-1 rounded-2xl bg-[#1D4ED8] text-sm font-bold text-white shadow-lg transition hover:bg-[#1E40AF] active:scale-[0.98]"
          >
            Unduh / Cetak
          </button>
        </div>
      </div>
    </div>
  );
}
