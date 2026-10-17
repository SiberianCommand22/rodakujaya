/**
 * Katalog voucher promo RODAKU — satu-satunya sumber kebenaran diskon.
 *
 * Dipakai di dua sisi:
 * - Klien (`BookingPanel`) untuk pratinjau harga coret ala Gojek.
 * - Server (`POST /api/orders`) untuk validasi agar tagihan di DB dan
 *   potongan RodaPay selalu memakai harga setelah diskon.
 */

export type PromoCode = "RODAHEMAT" | "RODABARU";

export type PromoDef =
  | { code: "RODAHEMAT"; kind: "percent"; percent: 25; label: string }
  | { code: "RODABARU"; kind: "flat"; amount: 5_000; label: string };

export const PROMOS: Record<PromoCode, PromoDef> = {
  RODAHEMAT: {
    code: "RODAHEMAT",
    kind: "percent",
    percent: 25,
    label: "Diskon 25%",
  },
  RODABARU: {
    code: "RODABARU",
    kind: "flat",
    amount: 5_000,
    label: "Potongan Rp 5.000",
  },
};

export type PromoResult = {
  code: PromoCode;
  discount: number;
  total: number;
  label: string;
};

/** Normalisasi input pengguna: " rodah_Emat " -> "RODAHEMAT". */
export function normalizePromoCode(input: unknown): PromoCode | null {
  if (typeof input !== "string") return null;
  const compact = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact === "RODAHEMAT" || compact === "RODABARU" ? compact : null;
}

/**
 * Hitung diskon dari tarif penuh. Total tidak pernah di bawah Rp 1.000 agar
 * ledger tidak mencatat pembayaran nol/negatif.
 */
export function applyPromo(fare: number, code: PromoCode | null): PromoResult | null {
  if (!code || !Number.isFinite(fare) || fare <= 0) return null;
  const def = PROMOS[code];
  if (!def) return null;

  const discount =
    def.kind === "percent"
      ? Math.round((fare * def.percent) / 100)
      : Math.min(def.amount, Math.max(0, fare - 1_000));

  if (discount <= 0) return null;
  return { code, discount, total: fare - discount, label: def.label };
}
