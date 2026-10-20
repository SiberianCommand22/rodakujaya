"use client";

import { useState } from "react";
import { formatIDR } from "@/lib/utils";
import { SOCKET_EVENTS, getSocket } from "@/lib/socket";
import {
  REVIEW_TAGS,
  buildReviewPayload,
  canSubmitReview,
  queueBadge,
  type SelectedRating,
} from "@/lib/tripSettlement";

export type TripSummary = {
  orderId: string;
  distanceKm: number;
  durationMinutes: number | null;
  fare: number;
  vehicleType: string;
  routeSource: string | null;
  driverName: string | null;
  plateNumber: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  /** Order status — AWAITING_PAYMENT means the trip ended and the customer still has to settle. */
  orderStatus?: string | null;
  /** Payment lifecycle from the server, or null when no payment row exists yet. */
  paymentStatus?: "PENDING" | "CLAIMED" | "PAID" | "FAILED" | null;
  method?: "CASH" | "BANK_TRANSFER" | null;
  /** Driver's bank details for the P2P transfer (present when the driver registered them). */
  bankName?: string | null;
  accountNumber?: string | null;
  accountHolderName?: string | null;
  /** True when payment is PAID — only the review step is outstanding. */
  paid?: boolean;
  /** Customer name (for driver's receipt) */
  customerName?: string | null;
  /** Order completion timestamp (ISO string) */
  completedAt?: string | null;
};

type Props = {
  open: boolean;
  summary: TripSummary | null;
  /** Unpaid bills waiting to be settled, in the order they should be shown. */
  queue?: { orderId: string }[];
  onClose: () => void;
  /** Fired after the current bill is settled; the parent decides what is next. */
  onSettled: () => void;
  /** Fired after a CASH payment completes so the parent can refresh to the paid view. */
  onPaymentUpdate?: () => void;
};

type Phase = "idle" | "claiming" | "claimingCash" | "processing" | "success" | "claimed" | "error";

const SUCCESS_DELAY_MS = 900;

/**
 * Struk perjalanan + penyelesaian tagihan peer-to-peer.
 *
 * Alur produksi (BANK_TRANSFER): driver mengakhiri perjalanan → order
 * AWAITING_PAYMENT → modal ini menampilkan rekening bank driver + tombol
 * "Saya Sudah Transfer" → Payment berstatus CLAIMED → driver memverifikasi di
 * m-banking lalu menekan "Konfirmasi Pembayaran Diterima" → lunas → ulasan.
 *
 * Alur tunai: pelanggan menekan "Bayar Tunai" → order langsung COMPLETED.
 *
 * Alur baru (langsung COMPLETED): driver "Sudah Sampai Tujuan" → order COMPLETED
 * + Payment CASH PAID otomatis → tampilkan "Hasil Pemesanan" (result view) di
 * kedua sisi (driver & pelanggan via polling) tanpa tahap bayar/klaim/ulasan.
 */
export default function TripSummaryModal({
  open,
  summary,
  queue = [],
  onClose,
  onSettled,
  onPaymentUpdate,
}: Props) {
  // No default star: an untouched modal must never submit a rating.
  const [rating, setRating] = useState<SelectedRating>(null);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Local override after a successful CASH payment before the parent refreshes. */
  const [cashPaid, setCashPaid] = useState(false);

  function toggleTag(tag: string) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  const orderId = summary?.orderId ?? null;
  const queueIndex = orderId ? queue.findIndex((q) => q.orderId === orderId) : -1;
  const badge = queueIndex === -1 ? null : queueBadge(queueIndex, queue.length);

  if (!open || !summary) return null;

  const estimated = summary.routeSource === "FALLBACK";
  const isPaid = summary.paid || cashPaid;
  const awaitingBankTransfer =
    !isPaid &&
    summary.orderStatus === "AWAITING_PAYMENT" &&
    summary.paymentStatus !== "CLAIMED";
  const claimedWaiting =
    !isPaid && (phase === "claimed" || summary.paymentStatus === "CLAIMED");
  const hasBankDetails = Boolean(summary.bankName && summary.accountNumber);

  /**
   * Customer taps "Saya Sudah Transfer" after sending money to the driver's
   * account. Moves Payment → CLAIMED and notifies the driver in real time.
   */
  async function claimTransfer() {
    if (phase !== "idle") return;
    setPhase("claiming");
    setError(null);
    try {
      const res = await fetch(`/api/orders/${summary!.orderId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "BANK_TRANSFER" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok && data?.error !== "ALREADY_CLAIMED") {
        throw new Error(data?.message ?? data?.error ?? "Gagal mengklaim transfer");
      }
      getSocket().emit(SOCKET_EVENTS.PAYMENT_CLAIMED, {
        orderId: summary!.orderId,
        amount: summary!.fare,
      });
      setPhase("claimed");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    }
  }

  /** CASH path: completes the order immediately, then opens the review step. */
  async function payCash() {
    if (phase !== "idle") return;
    setPhase("claimingCash");
    setError(null);
    try {
      const res = await fetch(`/api/orders/${summary!.orderId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "CASH" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok && data?.error !== "INVALID_STATE") {
        throw new Error(data?.message ?? data?.error ?? "Pembayaran tunai gagal");
      }
      setCashPaid(true);
      setPhase("idle");
      onPaymentUpdate?.();
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    }
  }

  async function copyAccount() {
    const text = summary!.accountNumber ?? "";
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  async function copyAllBankDetails() {
    const lines = [
      `Bank: ${summary!.bankName}`,
      `No. Rekening: ${summary!.accountNumber}`,
      `Atas Nama: ${summary!.accountHolderName ?? summary!.driverName ?? "-"}`,
      `Total: ${formatIDR(summary!.fare)}`,
    ].join("\n");
    try {
      await navigator.clipboard?.writeText(lines);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  /**
   * Files the review after the trip is paid. Payment itself is never handled
   * here — bank-transfer claims and cash payments have dedicated buttons.
   */
  async function submitReviewOnly(submitReview: boolean) {
    if (phase !== "idle" && phase !== "claimed") return;
    if (submitReview && !canSubmitReview(rating)) return;

    setPhase("processing");
    setError(null);

    try {
      const payload = submitReview
        ? buildReviewPayload(rating, comment, tags)
        : null;

      if (payload) {
        const reviewRes = await fetch(`/api/orders/${summary!.orderId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!reviewRes.ok) {
          const reviewData = await reviewRes.json().catch(() => null);
          if (reviewData?.error !== "ALREADY_REVIEWED") {
            throw new Error(reviewData?.message ?? "Ulasan gagal disimpan");
          }
        }
      }

      setPhase("success");
      setTimeout(() => onSettled(), SUCCESS_DELAY_MS);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    }
  }

  const showSuccess = phase === "success";
  const reviewBusy = phase === "processing" || phase === "success";

  // Format completion time
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

  // Hasil Pemesanan (Result View) — shown when order is COMPLETED & paid
  const showResultView = isPaid && summary.orderStatus === "COMPLETED";

  if (showResultView) {
    return (
      <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-[#0F172A]/70 p-4 backdrop-blur-sm">
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
              #{summary.orderId.slice(-8).toUpperCase()} · {formatCompletionTime(summary.completedAt)}
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
                    <p className="font-semibold text-[#0F172A]">{summary.driverName ?? "Mitra Driver"}</p>
                    <p className="text-xs text-slate-500">{summary.plateNumber ?? "-"}</p>
                  </div>
                </div>
                {summary.customerName && (
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Pelanggan</p>
                    <p className="font-semibold text-[#0F172A]">{summary.customerName}</p>
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
                <span className="text-slate-600 flex-1 truncate">{summary.pickupAddress ?? "-"}</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18.364 18.364A9 9 0 0 0 12 8a9 9 0 0 0-6.364 10.364" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </span>
                <span className="font-semibold text-[#0F172A]">Tujuan:</span>
                <span className="text-slate-600 flex-1 truncate">{summary.dropoffAddress ?? "-"}</span>
              </div>
            </div>

            {/* Stats: Distance & Fare */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Jarak</p>
                <p className="mt-1 text-2xl font-black text-[#0F172A] tabular-nums">{summary.distanceKm.toFixed(2)} km</p>
                {estimated && (
                  <p className="mt-0.5 text-[10px] font-medium text-amber-600">(estimasi)</p>
                )}
              </div>
              <div className="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total Tarif</p>
                <p className="mt-1 text-2xl font-black text-[#1D4ED8] tabular-nums">{formatIDR(summary.fare)}</p>
              </div>
            </div>

            {/* Actions: Selesai / Pesan Kembali */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
              >
                Selesai
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  window.location.href = "/";
                }}
                className="flex-1 rounded-2xl bg-[#1D4ED8] py-3 text-sm font-bold text-white shadow-xl transition hover:bg-[#1E40AF] active:scale-[0.98]"
              >
                Pesan Kembali
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Legacy flow for AWAITING_PAYMENT (bank transfer) — keep for backward compat
  return (
    <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-[#0F172A]/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ringkasan perjalanan"
        className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <div className="relative bg-[#1D4ED8] px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">
            Perjalanan Selesai
          </p>
          <h2 className="mt-1 text-2xl font-bold">Struk Perjalanan</h2>
          <p className="mt-1 text-sm text-blue-100">
            #{summary.orderId.slice(-8).toUpperCase()}
          </p>
        </div>

        {badge && (
          <div className="flex items-center justify-between gap-3 border-b border-blue-100 bg-amber-50 px-6 py-2.5 text-xs">
            <span className="font-semibold text-amber-800">{badge.text}</span>
            <span className="text-amber-700">
              {badge.total - badge.position + 1} tagihan menunggu
            </span>
          </div>
        )}

        {showSuccess ? (
          <div className="flex flex-col items-center gap-4 px-6 py-12">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
              <svg
                viewBox="0 0 24 24"
                className="h-10 w-10 animate-[pop_400ms_ease-out] text-emerald-600"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <p className="text-lg font-bold text-[#0F172A]">Selesai</p>
            <p className="text-center text-sm text-slate-500">
              Terima kasih! Ulasan Anda membantu mitra driver kami.
            </p>
          </div>
        ) : (
          <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto p-6">
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Jarak tempuh</dt>
                <dd className="font-semibold text-[#0F172A]">
                  {summary.distanceKm.toFixed(2)} km
                  {estimated && (
                    <span className="ml-1 text-[10px] font-medium text-amber-600">
                      (estimasi)
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Durasi</dt>
                <dd className="font-semibold text-[#0F172A]">
                  {summary.durationMinutes ? `${summary.durationMinutes} menit` : "-"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Armada</dt>
                <dd className="font-semibold text-[#0F172A]">
                  {summary.vehicleType === "RODA_MOBIL" ? "RodaMobil" : "RodaMotor"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Driver</dt>
                <dd className="font-semibold text-[#0F172A]">
                  {summary.driverName ?? "-"}
                  {summary.plateNumber && (
                    <span className="ml-1 text-xs font-normal text-slate-500">
                      {summary.plateNumber}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Metode bayar</dt>
                <dd className="font-semibold text-[#0F172A]">
                  {isPaid && summary.method === "CASH"
                    ? "Tunai"
                    : isPaid
                      ? "Transfer Bank"
                      : "Pilih di bawah"}
                </dd>
              </div>
            </dl>

            <div className="rounded-2xl border border-blue-100 bg-[#EFF6FF] px-4 py-3 text-xs text-slate-600">
              <p>
                <span className="font-semibold text-[#0F172A]">Jemput:</span>{" "}
                {summary.pickupAddress ?? "-"}
              </p>
              <p className="mt-1">
                <span className="font-semibold text-[#0F172A]">Tujuan:</span>{" "}
                {summary.dropoffAddress ?? "-"}
              </p>
            </div>

            {isPaid ? (
              <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-center text-xs font-bold text-emerald-700">
                ✓ Lunas — tinggal beri ulasan untuk driver Anda.
              </p>
            ) : claimedWaiting ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
                <p className="text-xs font-bold text-amber-800">
                  Transfer sudah diklaim
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                  Menunggu {summary.driverName ?? "driver"} memverifikasi penerimaan
                  dana di m-banking. Perjalanan akan lunas otomatis setelah dikonfirmasi.
                </p>
              </div>
            ) : awaitingBankTransfer ? (
              <div className="rounded-2xl border border-blue-200 bg-[#EFF6FF] px-4 py-3">
                <p className="text-xs font-bold text-[#0F172A]">
                  Bayar langsung ke rekening driver
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  Transfer sejumlah tagihan ke rekening di bawah, lalu tekan
                  &quot;Saya Sudah Transfer&quot;. Driver akan memverifikasi secara manual.
                </p>
                <div className="mt-2.5 rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm">
                  {hasBankDetails ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-500">
                          {summary.bankName}
                        </span>
                        <button
                          type="button"
                          onClick={() => void copyAccount()}
                          disabled={phase !== "idle"}
                          className="rounded-full bg-[#1D4ED8] px-2.5 py-1 text-[10px] font-black text-white transition hover:bg-[#1E40AF] disabled:opacity-60"
                        >
                          {copied ? "✓ Tersalin" : "Salin No. Rek"}
                        </button>
                      </div>
                      <p className="mt-1 text-lg font-black tabular-nums tracking-wide text-[#0F172A]">
                        {summary.accountNumber}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-slate-600">
                        a.n. {summary.accountHolderName ?? summary.driverName ?? "-"}
                      </p>
                      <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-sm">
                        <span className="text-slate-500">Total transfer: </span>
                        <span className="font-black text-[#1D4ED8]">
                          {formatIDR(summary.fare)}
                        </span>
                      </p>
                    </>
                  ) : (
                    <p className="py-2 text-center text-xs font-semibold text-amber-700">
                      Driver belum mendaftarkan rekening bank. Mintalah metode tunai
                      atau hubungi driver.
                    </p>
                  )}
                </div>
                {hasBankDetails && (
                  <button
                    type="button"
                    onClick={() => void copyAllBankDetails()}
                    disabled={phase !== "idle"}
                    className="mt-2 w-full rounded-xl border border-blue-200 bg-white py-1.5 text-[11px] font-bold text-[#1D4ED8] transition hover:bg-blue-50 disabled:opacity-60"
                  >
                    📋 Salin Detail Lengkap
                  </button>
                )}
              </div>
            ) : null}

            {isPaid ? (
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Beri Ulasan (opsional)
                </span>
                <div className="mt-2 flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      disabled={reviewBusy}
                      onClick={() => setRating(star as 1 | 2 | 3 | 4 | 5)}
                      aria-label={`${star} bintang`}
                      aria-pressed={star === rating}
                      className={`text-3xl leading-none transition disabled:opacity-60 ${
                        rating !== null && star <= rating
                          ? "text-amber-400"
                          : "text-slate-300"
                      }`}
                    >
                      ★
                    </button>
                  ))}
                  <span className="ml-2 self-center text-xs text-slate-500">
                    {rating === null ? "Belum dipilih" : `${rating}/5`}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Tag apresiasi driver">
                  {REVIEW_TAGS.map((tag) => {
                    const picked = tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        disabled={reviewBusy}
                        onClick={() => toggleTag(tag)}
                        aria-pressed={picked}
                        className={`rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-60 ${
                          picked
                            ? "bg-[#1D4ED8] text-white shadow"
                            : "bg-[#EFF6FF] text-[#1D4ED8] ring-1 ring-blue-100 hover:bg-blue-100"
                        }`}
                      >
                        {picked ? "✓ " : ""}{tag}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, 500))}
                  disabled={reviewBusy}
                  rows={2}
                  placeholder="Masukan untuk pengemudi (opsional)"
                  className="mt-2 w-full resize-none rounded-2xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20 disabled:opacity-60"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Lewati ulasan bila tidak ingin menilai. Rating driver tidak berubah
                  jika Anda tidak memilih bintang.
                </p>
              </div>
            ) : null}

            {error && (
              <p className="rounded-2xl bg-red-50 px-4 py-2 text-xs text-red-700" role="alert">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between rounded-2xl bg-[#0F172A] px-4 py-3 text-white">
              <span className="text-sm text-slate-300">
                {isPaid ? "Sudah dibayar" : "Total bayar"}
              </span>
              <span className="text-xl font-bold text-[#3B82F6]">
                {formatIDR(summary.fare)}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {isPaid ? (
                <>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => void submitReviewOnly(false)}
                      disabled={reviewBusy}
                      className="flex-1 rounded-2xl border border-blue-100 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      {phase === "processing" ? "Memproses..." : "Lewati Ulasan"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitReviewOnly(true)}
                      disabled={reviewBusy || !canSubmitReview(rating)}
                      title={
                        canSubmitReview(rating)
                          ? undefined
                          : "Pilih 1-5 bintang terlebih dahulu"
                      }
                      className="flex-1 rounded-2xl bg-[#1D4ED8] py-3 text-sm font-bold text-white shadow-xl transition hover:bg-[#1E40AF] active:scale-[0.98] disabled:opacity-60"
                    >
                      {phase === "processing" ? "Memproses..." : "Kirim Ulasan & Selesai"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={reviewBusy}
                    className="w-full rounded-2xl py-2 text-xs font-semibold text-slate-400 transition hover:text-slate-600 disabled:opacity-60"
                  >
                    Tutup
                  </button>
                </>
              ) : claimedWaiting ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-2xl border border-blue-100 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                >
                  Tutup — saya akan menunggu verifikasi
                </button>
              ) : awaitingBankTransfer ? (
                <>
                  {hasBankDetails && (
                    <button
                      type="button"
                      onClick={() => void claimTransfer()}
                      disabled={phase !== "idle"}
                      className="w-full rounded-2xl bg-[#1D4ED8] py-3.5 text-sm font-black text-white shadow-xl transition hover:bg-[#1E40AF] active:scale-[0.98] disabled:opacity-60"
                    >
                      {phase === "claiming" ? "Mengklaim..." : "Saya Sudah Transfer"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void payCash()}
                    disabled={phase !== "idle"}
                    className="w-full rounded-2xl border border-blue-100 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {phase === "claimingCash" ? "Memproses..." : "Bayar Tunai ke Driver"}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={phase !== "idle"}
                    className="w-full rounded-2xl py-2 text-xs font-semibold text-slate-400 transition hover:text-slate-600 disabled:opacity-60"
                  >
                    Bayar nanti
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-2xl border border-blue-100 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
                >
                  Tutup
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pop {
          0% { transform: scale(0.4); opacity: 0; }
          70% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}