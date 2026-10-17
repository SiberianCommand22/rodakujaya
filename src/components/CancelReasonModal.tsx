"use client";

import { useState } from "react";

export const CANCEL_REASONS = [
  "Driver terlalu lama sampai",
  "Ingin mengubah alamat tujuan",
  "Salah memilih armada motor/mobil",
  "Lainnya",
] as const;

type CancelReasonModalProps = {
  open: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
};

/** Konfirmasi pembatalan pesanan dengan alasan yang tersimpan di record order. */
export default function CancelReasonModal({
  open,
  busy = false,
  onConfirm,
  onClose,
}: CancelReasonModalProps) {
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2400] flex items-end justify-center bg-[#0F172A]/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Alasan pembatalan pesanan"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-black text-[#0F172A]">Batalkan Pesanan?</h2>
        <p className="mt-1 text-xs text-slate-500">
          Ceritakan alasan Anda agar kami bisa meningkatkan layanan.
        </p>

        <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label="Alasan pembatalan">
          {CANCEL_REASONS.map((option) => {
            const checked = reason === option;
            return (
              <label
                key={option}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-2.5 text-sm transition ${
                  checked
                    ? "border-[#1D4ED8] bg-blue-50/60 font-bold text-[#0F172A]"
                    : "border-slate-100 font-medium text-slate-600 hover:border-blue-200"
                }`}
              >
                <input
                  type="radio"
                  name="cancel-reason"
                  value={option}
                  checked={checked}
                  disabled={busy}
                  onChange={() => setReason(option)}
                  className="h-4 w-4 accent-[#1D4ED8]"
                />
                {option}
              </label>
            );
          })}
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-2xl border-2 border-slate-200 py-3 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Kembali
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason)}
            disabled={busy}
            className="flex-[2] rounded-2xl bg-red-500 py-3 text-sm font-black text-white shadow-xl transition hover:bg-red-600 disabled:opacity-60"
          >
            {busy ? "Membatalkan..." : "Ya, Batalkan"}
          </button>
        </div>
      </div>
    </div>
  );
}
