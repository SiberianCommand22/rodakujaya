"use client";

import { useCallback, useEffect, useState } from "react";
import { formatIDR } from "@/lib/utils";

type Row = {
  id: string;
  amount: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  note: string | null;
  createdAt: string;
  driver: { id: string; name: string; email: string; phone: string | null };
};

/** Persetujuan pencairan dana driver (khusus admin). */
export default function AdminWithdrawals() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/withdrawals?status=${filter}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Gagal memuat penarikan");
      setRows(data.withdrawals ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat");
    }
  }, [filter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function decide(id: string, action: "APPROVED" | "REJECTED") {
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ withdrawalId: id, action }),
      });
      if (!res.ok) throw new Error("Gagal memutus penarikan");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memutus");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-blue-100">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="text-sm font-black text-[#0F172A]">
          💸 Persetujuan Pencairan Dana ({rows.length})
        </h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs font-bold"
          aria-label="Filter status penarikan"
        >
          {["PENDING", "APPROVED", "REJECTED"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      {error && (
        <p className="mx-4 mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
      <div className="overflow-x-auto p-2">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="px-3 py-2">Driver</th>
              <th className="px-3 py-2">Tujuan</th>
              <th className="px-3 py-2">Nominal</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <p className="font-bold text-[#0F172A]">{w.driver.name}</p>
                  <p className="text-slate-400">{w.driver.email}</p>
                </td>
                <td className="px-3 py-2">
                  <p className="font-bold">{w.bankName}</p>
                  <p className="text-slate-500">{w.accountNumber} • {w.accountName}</p>
                </td>
                <td className="px-3 py-2 font-bold text-[#1D4ED8]">{formatIDR(w.amount)}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 font-bold ${
                      w.status === "APPROVED"
                        ? "bg-emerald-100 text-emerald-700"
                        : w.status === "REJECTED"
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {w.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {w.status === "PENDING" ? (
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === w.id}
                        onClick={() => decide(w.id, "APPROVED")}
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-700"
                      >
                        Setujui
                      </button>
                      <button
                        type="button"
                        disabled={busyId === w.id}
                        onClick={() => decide(w.id, "REJECTED")}
                        className="rounded-xl bg-red-50 px-3 py-1.5 font-bold text-red-600 hover:bg-red-100"
                      >
                        Tolak
                      </button>
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  Tidak ada pengajuan {filter}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
