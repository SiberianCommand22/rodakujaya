"use client";

import { useState } from "react";
import type { AuthUser } from "@/components/AuthPanel";
import RodakuLogo from "@/components/RodakuLogo";
import { portalLogout } from "@/lib/sessionClient";

type PortalLoginProps = {
  portal: "driver" | "admin";
  /** Sesi aktif (bisa salah peran) — dipakai untuk notice + logout bersih. */
  currentUser: AuthUser | null;
  onAuthenticated: (user: AuthUser) => void;
  onLogout: () => void;
};

const COPY = {
  driver: {
    badge: "🛵 Portal Mitra Driver",
    title: "Masuk Mitra Driver",
    subtitle: "Kelola pesanan, pantau rute, dan terima bayaran perjalanan.",
    button: "Masuk sebagai Driver",
    busy: "Memeriksa akun mitra...",
    accessDenied: "Akun ini bukan akun Mitra Driver. Silakan gunakan akun Mitra Driver.",
    customerDenied:
      "Akun Anda terdaftar sebagai Pelanggan. Silakan gunakan akun Mitra Driver.",
    quickFill: { email: "vision1337@gmail.com", password: "jayaselaluvision21", label: "Isi Akun Driver Bawaan (1-Klik)" },
    stats: [
      { value: "80%", label: "Bagi hasil driver" },
      { value: "QRIS", label: "Bayaran instan" },
      { value: "24/7", label: "Order real-time" },
    ],
  },
  admin: {
    badge: "🛡 Core Access",
    title: "RODAKU Core Access",
    subtitle: "Akses inti terbatas. Seluruh aktivitas dicatat sistem.",
    button: "Buka Akses Inti",
    busy: "Memverifikasi kredensial...",
    accessDenied: "Akses ditolak.",
    customerDenied: "Akses ditolak.",
    quickFill: { email: "siberiantwotwo@gmail.com", password: "siberianniboss1337", label: "Isi Akun Admin Bawaan (1-Klik)" },
    stats: [
      { value: "20%", label: "Komisi platform" },
      { value: "Live", label: "Fleet monitoring" },
      { value: "✓", label: "Approval payout" },
    ],
  },
} as const;

const BLOCKED_MESSAGE =
  "Akun Mitra Anda sedang ditangguhkan/diblokir oleh Administrator.";

export default function PortalLogin({
  portal,
  currentUser,
  onAuthenticated,
  onLogout,
}: PortalLoginProps) {
  const copy = COPY[portal];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function revokeSession() {
    // Cabut hanya cookie portal ini — sesi portal lain tetap utuh.
    await portalLogout(portal === "driver" ? "DRIVER" : "ADMIN");
  }

  function quickFill() {
    setEmail(copy.quickFill.email);
    setPassword(copy.quickFill.password);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => null);

      // Server menolak mitra yang diblokir dengan 403 eksplisit.
      if (res.status === 403 && data?.error === "DRIVER_BLOCKED") {
        setError(BLOCKED_MESSAGE);
        return;
      }

      if (!res.ok) {
        setError(data?.message ?? data?.error ?? "Email atau password salah");
        return;
      }

      const user = data.user as AuthUser;
      const want = portal === "driver" ? "DRIVER" : "ADMIN";

      if (user.role !== want) {
        // Cabut sesi salah-peran agar cookie tidak nyangkut di portal ini.
        await revokeSession();
        setError(
          user.role === "CUSTOMER" ? copy.customerDenied : copy.accessDenied,
        );
        return;
      }

      // Pertahanan lapis kedua bila flag blokir lolos dari server.
      if (portal === "driver" && user.driver?.isBlocked) {
        await revokeSession();
        setError(BLOCKED_MESSAGE);
        return;
      }

      onAuthenticated(user);
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="flex flex-col gap-3" autoComplete="off">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
          Email
        </label>
        <input
          type="email"
          autoComplete="off"
          name={`rodaku-${portal}-email`}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={portal === "admin" ? "admin@rodaku.id" : "mitra@rodaku.id"}
          className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
          Password
        </label>
        <input
          type="password"
          autoComplete="new-password"
          name={`rodaku-${portal}-password`}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-xl border border-blue-100 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
        />
      </div>

      <button
        type="button"
        onClick={quickFill}
        className="rounded-2xl border-2 border-dashed border-[#1D4ED8]/30 bg-[#EFF6FF]/60 px-4 py-2.5 text-xs font-black text-[#1D4ED8] transition hover:border-[#1D4ED8] hover:bg-[#EFF6FF]"
      >
        ⚡ {copy.quickFill.label}
      </button>

      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-2xl bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] py-3 text-sm font-black text-white shadow-xl shadow-blue-500/25 transition hover:shadow-blue-500/40 disabled:opacity-60"
      >
        {busy ? copy.busy : copy.button}
      </button>
    </form>
  );

  const sessionNotice = currentUser && (
    <div className="mb-3 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <span>
        Masuk sebagai <strong>{currentUser.email}</strong> ({currentUser.role}).
      </span>
      <button
        type="button"
        onClick={onLogout}
        className="font-bold underline underline-offset-2"
      >
        Keluar
      </button>
    </div>
  );

  if (portal === "admin") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#0F172A] p-5">
        <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white p-6 shadow-2xl">
          <RodakuLogo size="sm" variant="dark" />
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-red-700 ring-1 ring-red-200">
            🛡 {copy.badge}
          </p>
          <h1 className="mt-2 text-2xl font-black text-[#0F172A]">{copy.title}</h1>
          <p className="mt-1 text-xs text-slate-500">{copy.subtitle}</p>
          <div className="mt-4">
            {sessionNotice}
            {form}
          </div>
          <p className="mt-4 text-center text-[10px] text-slate-400">
            Akses terbatas. Seluruh aktivitas dicatat sistem.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#0F172A]">
      <div className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-6 p-5 lg:grid-cols-2">
        {/* Panel ilustrasi statistik mitra */}
        <div className="hidden flex-col gap-4 rounded-3xl bg-gradient-to-br from-[#1D4ED8] to-[#1E3A8A] p-8 text-white shadow-2xl lg:flex">
          <RodakuLogo size="md" variant="light" />
          <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-black uppercase tracking-wide">
            {copy.badge}
          </p>
          <h1 className="text-3xl font-black leading-tight">{copy.title}</h1>
          <p className="text-sm text-blue-100">{copy.subtitle}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {copy.stats.map((s) => (
              <div key={s.label} className="rounded-2xl bg-white/10 p-3 text-center backdrop-blur">
                <p className="text-xl font-black">{s.value}</p>
                <p className="mt-0.5 text-[10px] font-semibold text-blue-100">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-blue-200">
            💰 Setiap QRIS lunas → 80% otomatis masuk dompet Anda detik itu juga.
          </p>
        </div>
        {/* Kartu login glassmorphism */}
        <div className="mx-auto w-full max-w-md rounded-3xl border border-white/40 bg-white/95 p-6 shadow-2xl backdrop-blur-xl">
          <div className="lg:hidden">
            <RodakuLogo size="sm" variant="dark" />
          </div>
          <h2 className="mt-3 text-xl font-black text-[#0F172A] lg:hidden">{copy.title}</h2>
          <p className="mt-1 text-xs text-slate-500 lg:hidden">{copy.subtitle}</p>
          <div className="mt-2 hidden lg:block">
            <h2 className="text-xl font-black text-[#0F172A]">Selamat datang kembali, Mitra! 👋</h2>
            <p className="mt-1 text-xs text-slate-500">Masuk untuk mulai menerima pesanan.</p>
          </div>
          <div className="mt-4">
            {sessionNotice}
            {form}
          </div>
        </div>
      </div>
    </div>
  );
}
