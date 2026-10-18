"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import RodakuLogo from "@/components/RodakuLogo";
import type { AuthUser } from "@/components/AuthPanel";
import { INDONESIAN_BANKS } from "@/lib/walletContract";

type ProfileClientProps = {
  initialUser: AuthUser;
};

export default function ProfileClient({ initialUser }: ProfileClientProps) {
  const router = useRouter();
  const [name, setName] = useState(initialUser.name);
  const [phone, setPhone] = useState(initialUser.phone ?? "");
  const [bankName, setBankName] = useState(initialUser.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState(initialUser.accountNumber ?? "");
  const [accountHolderName, setAccountHolderName] = useState(
    initialUser.accountHolderName ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          bankName,
          accountNumber,
          accountHolderName,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.details) setFieldErrors(data.details);
        setError(data?.message ?? "Gagal memperbarui profil.");
        return;
      }
      setSuccess("Profil & rekening bank berhasil diperbarui.");
    } catch {
      setError("Tidak dapat terhubung ke server.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20";

  return (
    <div className="min-h-dvh bg-[#F8FAFC]">
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <RodakuLogo size="sm" variant="dark" />
          <div>
            <p className="text-sm font-black">Profil & Rekening</p>
            <p className="text-[11px] text-slate-500">{initialUser.email}</p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="ml-auto rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
          >
            ← Kembali
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        {initialUser.driver && (
          <p className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
            🛵 Akun Mitra Driver — {initialUser.driver.plateNumber} ·{" "}
            {initialUser.driver.vehicleType === "RODA_MOBIL" ? "Roda Mobil" : "Roda Motor"}
          </p>
        )}

        {error && (
          <p role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </p>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="name" className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              Nama Lengkap
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              autoComplete="name"
            />
            {fieldErrors.name && <p className="text-[11px] text-red-600">{fieldErrors.name}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="phone" className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              Telepon / WhatsApp
            </label>
            <input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              inputMode="tel"
              placeholder="081234567890"
              autoComplete="tel"
            />
            {fieldErrors.phone && <p className="text-[11px] text-red-600">{fieldErrors.phone}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="bankName" className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              Nama Bank
            </label>
            <select
              id="bankName"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className={inputClass}
            >
              <option value="">Pilih bank…</option>
              {INDONESIAN_BANKS.map((bank) => (
                <option key={bank} value={bank}>
                  {bank}
                </option>
              ))}
            </select>
            {fieldErrors.bankName && (
              <p className="text-[11px] text-red-600">{fieldErrors.bankName}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="accountNumber" className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              Nomor Rekening
            </label>
            <input
              id="accountNumber"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
              className={inputClass}
              inputMode="numeric"
              placeholder="1234567890"
              autoComplete="off"
            />
            {fieldErrors.accountNumber && (
              <p className="text-[11px] text-red-600">{fieldErrors.accountNumber}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="accountHolderName" className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              Nama Pemilik Rekening
            </label>
            <input
              id="accountHolderName"
              value={accountHolderName}
              onChange={(e) => setAccountHolderName(e.target.value)}
              className={inputClass}
              autoComplete="off"
            />
            {fieldErrors.accountHolderName && (
              <p className="text-[11px] text-red-600">{fieldErrors.accountHolderName}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-2xl bg-[#1D4ED8] py-3 text-sm font-black text-white transition hover:bg-[#1E40AF] disabled:opacity-60"
          >
            {busy ? "Menyimpan…" : "Simpan Perubahan"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-500">
          Rekening ini dipakai pelanggan untuk mentransfer tarif perjalanan
          langsung (P2P) setelah perjalanan selesai.
        </p>
      </main>
    </div>
  );
}
