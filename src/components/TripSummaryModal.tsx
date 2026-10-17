"use client";

import { useState } from "react";
import { formatIDR } from "@/lib/utils";
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
  /** True when the order was already paid and only the review is outstanding. */
  paid?: boolean;
};

type Props = {
  open: boolean;
  summary: TripSummary | null;
  /** Unpaid bills waiting to be settled, in the order they should be shown. */
  queue?: { orderId: string }[];
  onClose: () => void;
  /** Fired after the current bill is settled; the parent decides what is next. */
  onSettled: () => void;
};

type Phase = "idle" | "processing" | "success" | "error";

const SUCCESS_DELAY_MS = 900;

/**
 * Struk perjalanan + ulasan untuk pembayaran 100% QRIS.
 *
 * Alur produksi: pelanggan memindai QR dinamis di QRISPaymentModal terlebih
 * dahulu; modal ini tampil sesudahnya sebagai struk lunas + ulasan. Bila
 * entah bagaimana tampil sebelum lunas, tombol utama menyelesaikan
 * pembayaran QRIS lewat endpoint resmi (tanpa QR/timer tiruan).
 */
export default function TripSummaryModal({
  open,
  summary,
  queue = [],
  onClose,
  onSettled,
}: Props) {
  // No default star: an untouched modal must never submit a rating.
  const [rating, setRating] = useState<SelectedRating>(null);
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

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

  /**
   * Settles the bill via QRIS, then optionally files a review.
   *
   * `review` false means the customer tapped "Lewati Ulasan": the trip closes
   * without ever touching /review, so no record is created and the driver's
   * average is untouched.
   */
  async function settle(submitReview: boolean) {
    if (phase !== "idle") return;
    if (submitReview && !canSubmitReview(rating)) return;

    setPhase("processing");
    setError(null);

    try {
      // Payment is idempotent, so re-confirming an already-paid trip is safe.
      if (!summary!.paid) {
        const payRes = await fetch(`/api/orders/${summary!.orderId}/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "QRIS" }),
        });
        const payData = await payRes.json();
        if (!payRes.ok) {
          throw new Error(payData?.message ?? payData?.error ?? "Pembayaran gagal");
        }
      }

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
          const reviewData = await reviewRes.json();
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

        {phase === "success" ? (
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
            <p className="text-lg font-bold text-[#0F172A]">Pembayaran Berhasil</p>
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
                <dd className="font-semibold text-[#0F172A]">QRIS</dd>
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

            {summary.paid ? (
              <p className="rounded-2xl bg-emerald-50 px-4 py-2.5 text-center text-xs font-bold text-emerald-700">
                ✓ Lunas via QRIS — tinggal beri ulasan untuk driver Anda.
              </p>
            ) : (
              <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-center text-xs font-semibold text-amber-800">
                Pembayaran 100% QRIS — selesaikan untuk membuka ulasan.
              </p>
            )}

            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Beri Ulasan (opsional)
              </span>
              <div className="mt-2 flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    disabled={phase !== "idle"}
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
                      disabled={phase !== "idle"}
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
                disabled={phase !== "idle"}
                rows={2}
                placeholder="Masukan untuk pengemudi (opsional)"
                className="mt-2 w-full resize-none rounded-2xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20 disabled:opacity-60"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Lewati ulasan bila tidak ingin menilai. Rating driver tidak berubah
                jika Anda tidak memilih bintang.
              </p>
            </div>

            {error && (
              <p className="rounded-2xl bg-red-50 px-4 py-2 text-xs text-red-700" role="alert">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between rounded-2xl bg-[#0F172A] px-4 py-3 text-white">
              <span className="text-sm text-slate-300">
                {summary.paid ? "Sudah dibayar" : "Total bayar"}
              </span>
              <span className="text-xl font-bold text-[#3B82F6]">
                {formatIDR(summary.fare)}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void settle(false)}
                  disabled={phase !== "idle"}
                  className="flex-1 rounded-2xl border border-blue-100 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {phase === "processing" ? "Memproses..." : "Lewati Ulasan"}
                </button>
                <button
                  type="button"
                  onClick={() => void settle(true)}
                  disabled={phase !== "idle" || !canSubmitReview(rating)}
                  title={
                    canSubmitReview(rating)
                      ? undefined
                      : "Pilih 1-5 bintang terlebih dahulu"
                  }
                  className="flex-1 rounded-2xl bg-[#1D4ED8] py-3 text-sm font-bold text-white shadow-xl transition hover:bg-[#1E40AF] disabled:opacity-60"
                >
                  {phase === "processing" ? "Memproses..." : "Kirim Ulasan & Selesai"}
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={phase !== "idle"}
                className="w-full rounded-2xl py-2 text-xs font-semibold text-slate-400 transition hover:text-slate-600 disabled:opacity-60"
              >
                Tutup tanpa menyelesaikan tagihan
              </button>
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
