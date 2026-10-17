"use client";

import { useCallback, useEffect, useState } from "react";
import { SOCKET_EVENTS, getSocket } from "@/lib/socket";
import { formatIDR } from "@/lib/utils";

type Withdrawal = {
  id: string;
  amount: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
};

const BANKS = ["BCA", "BRI", "BNI", "MANDIRI", "JAGO", "WISE", "PAYPAL"] as const;

const STATUS_LABEL: Record<Withdrawal["status"], string> = {
  PENDING: "Menunggu",
  APPROVED: "Berhasil",
  REJECTED: "Ditolak",
};

/**
 * Kartu "Dompet & Pencairan Dana" untuk konsol driver.
 * Menampilkan Saldo Aktif + Saldo Tertahan, form tarik saldo,
 * dan riwayat status penarikan.
 */
export default function DriverWallet() {
  const [balance, setBalance] = useState<number | null>(null);
  const [locked, setLocked] = useState<number | null>(null);
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [bank, setBank] = useState<string>("BCA");
  const [acc, setAcc] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("50000");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/driver/withdraw");
      if (!res.ok) return;
      const data = await res.json();
      setBalance(data.wallet?.balance ?? null);
      setLocked(data.wallet?.lockedBalance ?? null);
      setRows(data.withdrawals ?? []);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // Saldo bertambah detik itu juga saat QRIS lunas (payment:settled).
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();
    const onSettled = () => void load();
    socket.on(SOCKET_EVENTS.PAYMENT_SETTLED, onSettled);
    return () => {
      socket.off(SOCKET_EVENTS.PAYMENT_SETTLED, onSettled);
    };
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/driver/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          bankName: bank,
          accountNumber: acc,
          accountName: name,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(data?.message ?? data?.error ?? "Pengajuan gagal");
        return;
      }
      setMsg("Pengajuan dibuat — saldo dikunci menunggu admin.");
      setBalance(data.wallet?.balance ?? null);
      setLocked(data.wallet?.lockedBalance ?? null);
      setAcc("");
      await load();
    } catch {
      setErr("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 text-[#0F172A]">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#1D4ED8]">
        Dompet &amp; Pencairan Dana
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-[#EFF6FF] p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Saldo Aktif</p>
          <p className="mt-1 text-lg font-black tabular-nums text-[#1D4ED8]">
            {balance !== null ? formatIDR(balance) : "…"}
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Saldo Tertahan</p>
          <p className="mt-1 text-lg font-black tabular-nums text-amber-700">
            {locked !== null ? formatIDR(locked) : "…"}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
        <p className="text-xs font-black">Tarik Saldo (min Rp 20.000)</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
            Bank / Kanal
            <select
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              className="rounded-xl border border-slate-200 px-2 py-2 text-sm text-[#0F172A]"
            >
              {BANKS.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
            Nominal (Rp)
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              className="rounded-xl border border-slate-200 px-2 py-2 text-sm tabular-nums"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
          Nomor Rekening / Akun
          <input
            value={acc}
            onChange={(e) => setAcc(e.target.value)}
            placeholder="cth: 8210456789"
            className="rounded-xl border border-slate-200 px-2 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
          Nama Pemilik
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama sesuai rekening"
            className="rounded-xl border border-slate-200 px-2 py-2 text-sm"
          />
        </label>
        {msg && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{msg}</p>}
        {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-2xl bg-[#1D4ED8] py-2.5 text-sm font-black text-white disabled:opacity-60"
        >
          {busy ? "Memproses…" : "Tarik Saldo →"}
        </button>
      </form>

      <div className="mt-4">
        <p className="text-xs font-black">Riwayat Penarikan</p>
        {rows.length === 0 ? (
          <p className="mt-1 text-xs text-slate-400">Belum ada pengajuan.</p>
        ) : (
          <ul className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
            {rows.map((w) => (
              <li key={w.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                <span>
                  <span className="font-black">{formatIDR(w.amount)}</span>
                  <span className="text-slate-500"> • {w.bankName} {w.accountNumber}</span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-bold ${
                    w.status === "APPROVED"
                      ? "bg-emerald-100 text-emerald-700"
                      : w.status === "REJECTED"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {STATUS_LABEL[w.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
