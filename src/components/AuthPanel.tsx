"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import RodakuLogo from "@/components/RodakuLogo";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "DRIVER" | "ADMIN";
  phone: string | null;
  googleId?: string | null;
  avatar?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  accountHolderName?: string | null;
  driver: {
    id: string;
    plateNumber: string;
    vehicleType: string;
    vehicleBrand?: string | null;
    isOnline: boolean;
    isBlocked: boolean;
  } | null;
};

type AuthPanelProps = {
  onAuthenticated: (user: AuthUser) => void;
  /**
   * Disimpan untuk kompatibilitas pemanggil lama.
   * Panel publik kini fleksibel: Pelanggan & Mitra Driver dalam satu form.
   */
  portal?: "customer" | "general";
  /** Tab awal saat dibuka dari modal landing (Pelanggan / Mitra Driver). */
  initialRole?: RoleTab;
};

type Mode = "login" | "register";
type RoleTab = "CUSTOMER" | "DRIVER";

const EMPTY = {
  name: "",
  phone: "",
  email: "",
  password: "",
  vehiclePlate: "",
  vehicleType: "RODA_MOTOR",
  vehicleBrand: "",
  bankName: "",
  accountNumber: "",
  accountHolderName: "",
};

const VEHICLE_OPTIONS = [
  { key: "RODA_MOTOR", label: "RodaMotor", icon: "🛵" },
  { key: "RODA_MOBIL", label: "RodaMobil", icon: "🚗" },
] as const;

const TABS: { key: RoleTab; label: string; icon: string }[] = [
  { key: "CUSTOMER", label: "Pelanggan", icon: "👤" },
  { key: "DRIVER", label: "Mitra Driver", icon: "🛵" },
];

export default function AuthPanel({ onAuthenticated, initialRole }: AuthPanelProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [roleTab, setRoleTab] = useState<RoleTab>(initialRole ?? "CUSTOMER");
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function update(key: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const payload =
      mode === "login"
        ? { email: form.email, password: form.password }
        : { ...form, role: roleTab };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Body bisa bukan JSON (mis. halaman error proxy saat database timeout),
      // jangan biarkan res.json() melempar dan menimpa pesan error backend.
      const data = await res.json().catch((parseError) => {
        console.error("[AuthPanel] respons bukan JSON valid:", {
          endpoint,
          status: res.status,
          parseError,
        });
        return null;
      });

      if (res.status !== 200 && res.status !== 201) {
        const message =
          data?.message ??
          data?.error ??
          `Permintaan ditolak server (HTTP ${res.status}). Coba lagi sebentar lagi.`;
        console.error("[AuthPanel] request gagal:", {
          endpoint,
          status: res.status,
          message,
          data,
        });
        setFieldErrors(data?.details ?? {});
        setError(message);
        return;
      }

      const user = data?.user as AuthUser | undefined;
      if (!user) {
        console.error("[AuthPanel] respons sukses tanpa objek user:", {
          endpoint,
          status: res.status,
          data,
        });
        setError("Respons server tidak lengkap. Coba lagi.");
        return;
      }

      // Stealth: akun admin tidak dipakai di panel publik, tanpa membocorkan /admin.
      if (user.role === "ADMIN") {
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch (logoutError) {
          console.error("[AuthPanel] gagal logout admin:", logoutError);
        }
        setError("Akun ini tidak dapat digunakan di sini.");
        return;
      }

      onAuthenticated(user);

      // Mitra driver langsung diarahkan ke konsol driver.
      if (user.role === "DRIVER") {
        router.push("/driver");
      }
    } catch (networkError) {
      console.error("[AuthPanel] gagal terhubung ke server:", {
        endpoint,
        networkError,
      });
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof typeof EMPTY, label: string, extra?: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
        {label}
      </label>
      {extra ?? (
        <input
          type={key === "password" ? "password" : "text"}
          value={form[key]}
          onChange={(e) => update(key, e.target.value)}
          className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
        />
      )}
      {fieldErrors[key] && (
        <span className="text-[11px] text-red-600">{fieldErrors[key]}</span>
      )}
    </div>
  );

  return (
    <section className="flex h-full flex-col gap-4 overflow-y-auto bg-white p-5">
      <header>
        <RodakuLogo size="sm" variant="dark" />
        <h1 className="mt-1 text-2xl font-black tracking-tight text-[#0F172A]">
          {mode === "login" ? "Masuk ke RODAKU" : "Daftar Akun Baru"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {roleTab === "CUSTOMER"
            ? "Pesan perjalanan cepat ala Gojek."
            : "Kelola pesanan & terima bayaran perjalanan."}
        </p>
      </header>

      {/* Segmented Tab Switcher: Pelanggan & Mitra Driver */}
      <div
        role="tablist"
        aria-label="Pilih peran"
        className="grid grid-cols-2 gap-1 rounded-2xl bg-[#EFF6FF] p-1"
      >
        {TABS.map((tab) => {
          const active = roleTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setRoleTab(tab.key);
                setError(null);
                setFieldErrors({});
              }}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-black transition ${
                active
                  ? "bg-[#1D4ED8] text-white shadow-lg"
                  : "text-[#1D4ED8]/70 hover:bg-white/70 hover:text-[#1D4ED8]"
              }`}
            >
              <span aria-hidden>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Mode switcher: Masuk / Daftar */}
      <div className="flex items-center justify-center gap-1 text-xs font-bold">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
              setFieldErrors({});
            }}
            className={`rounded-full px-4 py-1.5 transition ${
              mode === m
                ? "bg-[#0F172A] text-white"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {m === "login" ? "Masuk (Login)" : "Daftar Akun Baru"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === "register" && (
          <>
            {field("name", "Nama Lengkap")}
            {field("phone", "No. Telepon", (
              <input
                type="tel"
                inputMode="tel"
                placeholder="081234567890"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
              />
            ))}
            {roleTab === "DRIVER" && (
              <div className="rounded-2xl border border-blue-100 bg-[#EFF6FF]/60 p-3">
                <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-[#1D4ED8]">
                  🛵 Data Kendaraan Mitra
                </p>
                <div className="mb-2 flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                    Jenis Kendaraan
                  </span>
                  <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Jenis kendaraan">
                    {VEHICLE_OPTIONS.map((opt) => {
                      const selected = form.vehicleType === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => update("vehicleType", opt.key)}
                          className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-black transition ${
                            selected
                              ? "border-[#1D4ED8] bg-[#1D4ED8] text-white shadow"
                              : "border-blue-100 bg-white text-slate-600 hover:border-[#1D4ED8]/40"
                          }`}
                        >
                          <span aria-hidden>{opt.icon}</span>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {fieldErrors.vehicleType && (
                    <span className="text-[11px] text-red-600">{fieldErrors.vehicleType}</span>
                  )}
                </div>
                {field("vehiclePlate", "Nomor Plat Kendaraan", (
                  <input
                    type="text"
                    placeholder="B 1337 RDK"
                    autoComplete="off"
                    value={form.vehiclePlate}
                    onChange={(e) => update("vehiclePlate", e.target.value.toUpperCase())}
                    className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-bold uppercase tracking-wide outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
                  />
                ))}
                {field("vehicleBrand", "Merek / Tipe Kendaraan", (
                  <input
                    type="text"
                    placeholder="Honda Beat / Toyota Avanza"
                    autoComplete="off"
                    value={form.vehicleBrand}
                    onChange={(e) => update("vehicleBrand", e.target.value)}
                    className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
                  />
                ))}
              </div>
            )}
          </>
        )}

        {field("email", "Email", (
          <input
            type="email"
            autoComplete="email"
            placeholder={roleTab === "DRIVER" ? "mitra@rodaku.id" : "nama@email.com"}
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
        ))}
        {field("password", "Password", (
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="••••••••"
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
          />
        ))}

        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-2xl bg-[#1D4ED8] py-3 text-sm font-black text-white shadow-xl transition hover:bg-[#1E40AF] disabled:opacity-60"
        >
          {busy
            ? "Memproses..."
            : mode === "login"
              ? roleTab === "DRIVER"
                ? "Masuk sebagai Driver →"
                : "Masuk & Pesan Perjalanan →"
              : roleTab === "DRIVER"
                ? "Daftar sebagai Mitra Driver"
                : "Daftar Sekarang"}
        </button>
      </form>

      <p className="text-center text-[11px] leading-relaxed text-slate-400">
        {roleTab === "DRIVER"
          ? "Mitra driver yang masuk akan otomatis diarahkan ke konsol driver."
          : "Pelanggan yang masuk langsung bisa memesan perjalanan."}
      </p>
    </section>
  );
}
