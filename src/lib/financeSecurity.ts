import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Pertahanan finansial terpusat: HMAC webhook QRIS, idempotency key,
 * dan validasi payout. Bebas Prisma agar bisa dipakai route + lib.
 */

/** Minimum penarikan driver: Rp 20.000. */
export const MIN_WITHDRAWAL_AMOUNT = 20_000;

/** Batas atas yang butuh perhatian admin (auto-flag, tetap PENDING). */
export const WITHDRAWAL_REVIEW_THRESHOLD = 1_000_000;

export const SUPPORTED_BANKS = [
  "BCA",
  "BRI",
  "BNI",
  "MANDIRI",
  "JAGO",
  "WISE",
  "PAYPAL",
] as const;

/** Canonical payload yang ditandatangani acquirer: orderId.status.amount */
export function buildWebhookPayload(orderId: string, status: string, amount: number): string {
  return `${orderId}.${status}.${amount}`;
}

export function signQrisWebhook(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Verifikasi HMAC-SHA256 header `x-callback-signature`.
 * - Jika QRIS_WEBHOOK_SECRET belum dikonfigurasi → sandbox: lolos dengan
 *   peringatan (agar localhost & test suite tetap jalan).
 * - Jika secret ada → signature wajib valid (timing-safe).
 */
export function verifyQrisWebhookSignature(
  orderId: string,
  status: string,
  amount: number,
  signature: string | null,
): { ok: boolean; mode: "verified" | "sandbox-open" } {
  const secret = process.env.QRIS_WEBHOOK_SECRET ?? "";
  if (!secret) return { ok: true, mode: "sandbox-open" };
  if (!signature) return { ok: false, mode: "verified" };
  const expected = signQrisWebhook(buildWebhookPayload(orderId, status, amount), secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim(), "utf8");
  if (a.length !== b.length) return { ok: false, mode: "verified" };
  return { ok: timingSafeEqual(a, b), mode: "verified" };
}

/** Idempotency ref unik per mutasi ledger: prefix + uuid pendek. */
export function newTxRef(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
}

/** Tx hash unik per pengajuan withdrawal. */
export function newWithdrawalTxHash(): string {
  return `WD-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
}

/** True bila amount bilangan bulat positif. */
export function isPositiveAmount(amount: unknown): amount is number {
  return typeof amount === "number" && Number.isFinite(amount) && amount > 0 && Number.isInteger(Math.round(amount));
}

export function sanitizeBankName(bank: unknown): string | null {
  if (typeof bank !== "string") return null;
  const v = bank.trim().toUpperCase();
  return (SUPPORTED_BANKS as readonly string[]).includes(v) ? v : null;
}

export function sanitizeAccountNumber(acc: unknown): string | null {
  if (typeof acc !== "string") return null;
  const v = acc.trim().replace(/[\s-]/g, "");
  if (!/^[A-Za-z0-9@._+]{4,64}$/.test(v)) return null;
  return v;
}
