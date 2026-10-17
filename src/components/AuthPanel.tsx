"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import RodakuLogo from "@/components/RodakuLogo";

function GoogleGIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

type GoogleDemoProfile = { name: string; email: string; googleId: string; avatar: string };

const GOOGLE_DEMO_PROFILES: GoogleDemoProfile[] = [
  {
    name: "Budi Santoso",
    email: "budi.santoso.demo@gmail.com",
    googleId: "demo-google-uid-budi-001",
    avatar: "https://i.pravatar.cc/100?img=12",
  },
  {
    name: "Siti Rahayu",
    email: "siti.rahayu.demo@gmail.com",
    googleId: "demo-google-uid-siti-002",
    avatar: "https://i.pravatar.cc/100?img=47",
  },
  {
    name: "Andi Pratama",
    email: "andi.pratama.demo@gmail.com",
    googleId: "demo-google-uid-andi-003",
    avatar: "https://i.pravatar.cc/100?img=59",
  },
];

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "DRIVER" | "ADMIN";
  phone: string | null;
  googleId?: string | null;
  avatar?: string | null;
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
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googlePickerOpen, setGooglePickerOpen] = useState(false);
  const gisLoaded = useRef(false);

  function update(key: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";    const payload =
      mode === "login"
        ? { email: form.email, password: form.password }
        : { ...form, role: roleTab };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setFieldErrors(data?.details ?? {});
        setError(data?.message ?? data?.error ?? "Gagal memproses");
        return;
      }

      const user = data.user as AuthUser;

      // Stealth: akun admin tidak dipakai di panel publik, tanpa membocorkan /admin.
      if (user.role === "ADMIN") {
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          /* abaikan */
        }
        setError("Akun ini tidak dapat digunakan di sini.");
        return;
      }

      onAuthenticated(user);

      // Mitra driver langsung diarahkan ke konsol driver.
      if (user.role === "DRIVER") {
        router.push("/driver");
      }
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  const handleGoogleProfile = useCallback(
    async (profile: GoogleDemoProfile | { email: string; name: string; googleId?: string; avatar?: string }) => {
      setGoogleBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: profile.email,
            name: profile.name,
            googleId: "googleId" in profile ? (profile.googleId ?? null) : null,
            avatar: "avatar" in profile ? ((profile as { avatar?: string }).avatar ?? null) : null,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.message ?? data?.error ?? "Gagal masuk dengan Google");
          return;
        }
        const user = data.user as AuthUser;
        if (user.role === "ADMIN") {
          try {
            await fetch("/api/auth/logout", { method: "POST" });
          } catch {
            /* abaikan */
          }
          setError("Akun ini tidak dapat digunakan di sini.");
          return;
        }
        setGooglePickerOpen(false);
        onAuthenticated(user);
        if (user.role === "DRIVER") {
          router.push("/driver");
        }
      } catch {
        setError("Tidak dapat terhubung ke server");
      } finally {
        setGoogleBusy(false);
      }
    },
    [onAuthenticated, router],
  );

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      setGoogleBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.message ?? data?.error ?? "Gagal masuk dengan Google");
          return;
        }
        const user = data.user as AuthUser;
        if (user.role === "ADMIN") {
          try {
            await fetch("/api/auth/logout", { method: "POST" });
          } catch {
            /* abaikan */
          }
          setError("Akun ini tidak dapat digunakan di sini.");
          return;
        }
        setGooglePickerOpen(false);
        onAuthenticated(user);
        if (user.role === "DRIVER") {
          router.push("/driver");
        }
      } catch {
        setError("Tidak dapat terhubung ke server");
      } finally {
        setGoogleBusy(false);
      }
    },
    [onAuthenticated, router],
  );

  // Google Identity Services: muat sekali bila CLIENT_ID tersedia, lalu
  // panggil One Tap saat dialog demo dibuka.
  useEffect(() => {
    if (!googlePickerOpen || !GOOGLE_CLIENT_ID || gisLoaded.current) return;
    if (typeof window === "undefined") return;
    if (window.google?.accounts?.id) {
      gisLoaded.current = true;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response: { credential?: string }) => {
          if (response?.credential) void handleGoogleCredential(response.credential);
        },
      });
      window.google.accounts.id.prompt();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      gisLoaded.current = true;
      try {
        window.google?.accounts?.id?.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response: { credential?: string }) => {
            if (response?.credential) void handleGoogleCredential(response.credential);
          },
        });
        window.google?.accounts?.id?.prompt();
      } catch {
        /* GIS opsional — fallback demo tetap tersedia */
      }
    };
    document.head.appendChild(script);
  }, [googlePickerOpen, handleGoogleCredential]);

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

        {mode === "login" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setForm((prev) => ({
                ...prev,
                email: roleTab === "DRIVER" ? "vision1337@gmail.com" : "gendengsekali1337@gmail.com",
                password: roleTab === "DRIVER" ? "jayaselaluvision21" : "gendengkowerika1337",
              }));
              setError(null);
              setFieldErrors({});
            }}
            className="rounded-2xl border-2 border-dashed border-[#1D4ED8]/30 bg-[#EFF6FF]/60 py-2.5 text-xs font-black text-[#1D4ED8] transition hover:border-[#1D4ED8] hover:bg-[#EFF6FF] disabled:opacity-60"
          >
            ⚡ Isi Akun Demo 1-Klik (
            {roleTab === "DRIVER" ? "vision1337@gmail.com" : "gendengsekali1337@gmail.com"})
          </button>
        )}
      </form>

      {roleTab === "CUSTOMER" && (
        <>
          {/* Pemisah elegan */}
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              atau lanjutkan dengan
            </span>
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Tombol standar Google */}
          <button
            type="button"
            disabled={googleBusy}
            onClick={() => {
              setError(null);
              setGooglePickerOpen(true);
            }}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
          >
            <GoogleGIcon />
            {googleBusy ? "Menghubungkan ke Google..." : "Masuk dengan Google"}
          </button>
        </>
      )}

      <p className="text-center text-[11px] leading-relaxed text-slate-400">
        {roleTab === "DRIVER"
          ? "Mitra driver yang masuk akan otomatis diarahkan ke konsol driver."
          : "Pelanggan yang masuk langsung bisa memesan perjalanan."}
      </p>

      {/* Dialog pilihan akun Google — instan untuk localhost, GIS bila tersedia */}
      {googlePickerOpen && (
        <div
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Pilih akun Google"
          onClick={() => {
            if (!googleBusy) setGooglePickerOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <GoogleGIcon />
              <div>
                <h2 className="text-base font-black tracking-tight text-[#0F172A]">
                  Pilih akun Google
                </h2>
                <p className="text-xs text-slate-500">
                  {GOOGLE_CLIENT_ID
                    ? "Login Google asli via Identity Services, atau akun demo instan."
                    : "Mode localhost — pilih akun demo instan untuk pengetesan."}
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup"
                disabled={googleBusy}
                onClick={() => setGooglePickerOpen(false)}
                className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {GOOGLE_DEMO_PROFILES.map((profile) => (
                <button
                  key={profile.googleId}
                  type="button"
                  disabled={googleBusy}
                  onClick={() => void handleGoogleProfile(profile)}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-left transition hover:border-[#1D4ED8]/40 hover:bg-[#EFF6FF]/50 disabled:opacity-60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={profile.avatar}
                    alt=""
                    width={36}
                    height={36}
                    className="h-9 w-9 rounded-full bg-slate-100 object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-[#0F172A]">
                      {profile.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {profile.email}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
              {GOOGLE_CLIENT_ID
                ? "One Tap Google akan muncul otomatis. Akun demo hanya untuk localhost."
                : "Isi NEXT_PUBLIC_GOOGLE_CLIENT_ID di environment untuk login Google asli (GIS)."}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
