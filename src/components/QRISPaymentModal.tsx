"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { SOCKET_EVENTS, getSocket } from "@/lib/socket";
import { formatCountdown, QRIS_MERCHANT_NAME } from "@/lib/qris";
import { formatIDR } from "@/lib/utils";

export type QrisSettlementView = {
  amount: number;
  platformFee: number;
  driverShare: number;
  alreadyPaid: boolean;
};

type QrisInvoiceView = {
  txRef: string;
  amount: number;
  discount: number;
  promoCode: string | null;
  qrisString: string;
  expiresAt: string;
};

type QRISPaymentModalProps = {
  open: boolean;
  orderId: string | null;
  fare: number;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  onPaid: (settlement: QrisSettlementView) => void;
  onClose: () => void;
};

type Phase = "loading" | "ready" | "verifying" | "error" | "expired";

function isSandboxHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * Modal pembayaran QRIS 100%: QR dinamis per order, nominal pas harga akhir,
 * countdown 15:00, polling status, dan tombol Sandbox Pay yang hanya muncul
 * di localhost untuk menguji callback webhook.
 */
export default function QRISPaymentModal({
  open,
  orderId,
  fare,
  pickupAddress,
  dropoffAddress,
  onPaid,
  onClose,
}: QRISPaymentModalProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [invoice, setInvoice] = useState<QrisInvoiceView | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(15 * 60);
  const [error, setError] = useState<string | null>(null);
  // Hostname tidak berubah selama sesi; inisialisasi malas menghindari
  // setState sinkron di dalam effect.
  const [sandbox] = useState<boolean>(() => isSandboxHost());
  const settledRef = useRef(false);

  const loadInvoice = useCallback(async () => {
    if (!orderId) return;
    setPhase("loading");
    setError(null);
    settledRef.current = false;
    try {
      const res = await fetch("/api/payment/qris", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? "Gagal menerbitkan QRIS");
      }
      if (data?.alreadyPaid) {
        // Tagihan sudah lunas (mis. webhook tiba lebih dulu).
        onPaid({ amount: fare, platformFee: 0, driverShare: 0, alreadyPaid: true });
        return;
      }
      const next = data?.invoice as QrisInvoiceView;
      if (!next?.qrisString) throw new Error("Invoice QRIS tidak valid");
      setInvoice(next);
      const url = await QRCode.toDataURL(next.qrisString, {
        width: 512,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      setQrDataUrl(url);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat QRIS");
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    if (!open || !orderId) return;
    // Muat via macrotask agar tidak setState sinkron di badan effect.
    const initial = setTimeout(() => void loadInvoice(), 0);
    return () => clearTimeout(initial);
  }, [open, orderId, loadInvoice]);

  // Countdown 15:00 dari expiresAt invoice.
  useEffect(() => {
    if (!open || phase !== "ready" || !invoice) return;
    const tick = () => {
      const target = new Date(invoice.expiresAt).getTime();
      const left = Math.max(0, Math.floor((target - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setPhase("expired");
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [open, phase, invoice]);

  // Polling status tiap 3 detik: tangkap pelunasan dari kanal mana pun.
  useEffect(() => {
    if (!open || !orderId || phase !== "ready") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/payment/qris?orderId=${encodeURIComponent(orderId)}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.payment?.status === "PAID" && !settledRef.current) {
          settledRef.current = true;
          const amount = data.payment.amount ?? invoice?.amount ?? fare;
          getSocket().emit(SOCKET_EVENTS.PAYMENT_SETTLED, { orderId, amount });
          onPaid({
            amount,
            platformFee: Math.round(amount * 0.2),
            driverShare: amount - Math.round(amount * 0.2),
            alreadyPaid: false,
          });
        }
      } catch {
        /* polling best-effort */
      }
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderId, phase]);

  async function sandboxPay() {
    if (!orderId || phase === "verifying") return;
    setPhase("verifying");
    setError(null);
    try {
      // Verifikasi pelunasan resmi: PAID + bagi hasil 20/80 + idempoten.
      const res = await fetch("/api/payment/qris/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? "Verifikasi QRIS gagal");
      }
      const settlement = data?.settlement as QrisSettlementView | undefined;
      settledRef.current = true;
      getSocket().emit(SOCKET_EVENTS.PAYMENT_SETTLED, {
        orderId,
        amount: settlement?.amount ?? invoice?.amount ?? fare,
      });
      onPaid(
        settlement ?? {
          amount: invoice?.amount ?? fare,
          platformFee: 0,
          driverShare: 0,
          alreadyPaid: false,
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sandbox pay gagal");
      setPhase("ready");
    }
  }

  if (!open || !orderId) return null;

  const amount = invoice?.amount ?? fare;
  const progress = Math.max(0, Math.min(1, secondsLeft / (15 * 60)));

  return (
    <div className="fixed inset-0 z-[2300] flex items-center justify-center bg-[#0F172A]/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pembayaran QRIS"
        className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        {/* Header: logo resmi QRIS */}
        <div className="flex items-center gap-3 bg-white px-6 pb-2 pt-5">
          <span
            aria-hidden
            className="flex items-center overflow-hidden rounded-lg text-2xl font-black tracking-tight shadow-sm"
          >
            <span className="bg-[#E31E24] px-2 py-1 text-white">QR</span>
            <span className="bg-white px-1 py-1 text-[#0F172A] ring-1 ring-slate-200">IS</span>
          </span>
          <div>
            <p className="text-sm font-black leading-tight text-[#0F172A]">
              Quick Response Code Indonesian Standard
            </p>
            <p className="text-[11px] text-slate-500">{QRIS_MERCHANT_NAME} • #{orderId.slice(-8).toUpperCase()}</p>
          </div>
        </div>

        <div className="flex max-h-[72dvh] flex-col items-center gap-3 overflow-y-auto px-6 pb-5 pt-2">
          {phase === "loading" && (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-slate-500">
              <span className="h-8 w-8 animate-spin rounded-full border-4 border-blue-100 border-t-[#1D4ED8]" aria-hidden />
              Menerbitkan QRIS dinamis…
            </div>
          )}

          {phase === "error" && (
            <div className="flex w-full flex-col items-center gap-3 py-8">
              <p className="rounded-2xl bg-red-50 px-4 py-2 text-xs text-red-700" role="alert">
                {error ?? "Gagal memuat QRIS"}
              </p>
              <button
                type="button"
                onClick={() => void loadInvoice()}
                className="rounded-2xl bg-[#1D4ED8] px-5 py-2.5 text-sm font-bold text-white"
              >
                Coba Lagi
              </button>
            </div>
          )}

          {(phase === "ready" || phase === "verifying" || phase === "expired") && (
            <>
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt={`Kode QRIS ${formatIDR(amount)}`}
                  className="h-56 w-56 rounded-2xl bg-white object-contain shadow-lg ring-1 ring-slate-200"
                />
              ) : (
                <div className="grid h-56 w-56 place-items-center rounded-2xl bg-slate-100 text-xs text-slate-400">
                  QR tidak tersedia
                </div>
              )}

              <div className="text-center">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Total tagihan
                </p>
                <p className="text-3xl font-black tabular-nums text-[#0F172A]">
                  {formatIDR(amount)}
                </p>
                {invoice?.discount ? (
                  <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700">
                    ✓ Hemat {formatIDR(invoice.discount)}
                    {invoice.promoCode ? ` • ${invoice.promoCode}` : ""}
                  </p>
                ) : null}
              </div>

              {(pickupAddress || dropoffAddress) && (
                <div className="w-full rounded-2xl bg-slate-50 px-4 py-2.5 text-[11px] leading-relaxed text-slate-600">
                  {pickupAddress && <p className="truncate">📍 {pickupAddress}</p>}
                  {dropoffAddress && <p className="truncate">🏁 {dropoffAddress}</p>}
                </div>
              )}

              {/* Countdown 15:00 */}
              <div className="w-full text-center">
                <p
                  className={`text-lg font-black tabular-nums ${phase === "expired" ? "text-red-600" : "text-[#1D4ED8]"}`}
                  role="timer"
                >
                  {phase === "expired" ? "QR Kedaluwarsa" : formatCountdown(secondsLeft)}
                </p>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${secondsLeft < 120 ? "bg-red-500" : "bg-[#1D4ED8]"}`}
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                {phase === "expired" && (
                  <button
                    type="button"
                    onClick={() => void loadInvoice()}
                    className="mt-2 rounded-2xl bg-[#1D4ED8] px-5 py-2 text-xs font-black text-white"
                  >
                    Muat Ulang QR Baru
                  </button>
                )}
              </div>

              {/* Status bar berdenyut */}
              {phase !== "expired" && (
                <div className="flex w-full items-center gap-2 rounded-2xl bg-[#EFF6FF] px-4 py-2.5 text-[11px] font-bold text-[#1D4ED8]">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1D4ED8] opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#1D4ED8]" />
                  </span>
                  {phase === "verifying"
                    ? "Memverifikasi pembayaran…"
                    : "Menunggu pembayaran via BCA, GoPay, OVO, Dana, ShopeePay…"}
                </div>
              )}

              {error && (
                <p className="w-full rounded-2xl bg-red-50 px-4 py-2 text-center text-[11px] text-red-700" role="alert">
                  {error}
                </p>
              )}

              {/* Sandbox Pay — hanya di localhost */}
              {sandbox && phase !== "expired" && (
                <button
                  type="button"
                  onClick={() => void sandboxPay()}
                  disabled={phase === "verifying"}
                  title="Menguji callback webhook /api/payment/qris/webhook di localhost"
                  className="w-full rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-2.5 text-xs font-black text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
                >
                  {phase === "verifying" ? "Memproses…" : "🧪 Simulasi Scan Bayar (Sandbox Pay)"}
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-2xl py-1.5 text-xs font-semibold text-slate-400 transition hover:text-slate-600"
              >
                Tutup (bayar nanti dari riwayat)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
