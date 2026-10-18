import { Prisma } from "@prisma/client";

/**
 * Legacy wallet module — wallet/saldo system removed for pure P2P bank
 * transfer. Only `toRupiah` remains (Decimal → number helper used by
 * settlement and API routes).
 */

/**
 * Decimal → number for JSON responses.
 *
 * Amounts are integral rupiah, but `Math.round` guards against float dust.
 */
export function toRupiah(value: Prisma.Decimal | number): number {
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? Math.round(n) : 0;
}
