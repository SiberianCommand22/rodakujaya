/**
 * Client-safe contract shared by the RodaPay server helpers and the UI.
 *
 * Kept free of Prisma imports so client components can use the constants and
 * types without pulling the database driver into the browser bundle.
 */

/** Welcome credit granted to every account at registration. */
export const WELCOME_BALANCE = 100_000;

/** Fixed top-up denominations offered during the pilot. */
export const TOPUP_OPTIONS = [20_000, 50_000, 100_000] as const;

/** Minimum penarikan driver (anti-debu + biaya transfer). */
export const MIN_WITHDRAWAL = 20_000;

/** Bank domestik + kanal internasional yang didukung form payout. */
export const WITHDRAWAL_BANKS = [
  "BCA",
  "BRI",
  "BNI",
  "MANDIRI",
  "JAGO",
  "WISE",
  "PAYPAL",
] as const;

export type WalletTransactionType = "TOPUP" | "PAYMENT";

export type WalletTransactionView = {
  id: string;
  /** Always positive: the `type` decides the direction. */
  amount: number;
  type: string;
  description: string;
  createdAt: string;
};

export type WalletSnapshot = {
  id: string;
  balance: number;
  lockedBalance: number;
  availableBalance: number;
  transactions: WalletTransactionView[];
};

/** True when `amount` is one of the allowed top-up denominations. */
export function isValidTopupAmount(amount: unknown): amount is number {
  return (
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    (TOPUP_OPTIONS as readonly number[]).includes(amount)
  );
}

/** `20000` → `Rp 20.000`, for compact inline labels. */
export function formatTopup(amount: number): string {
  return `Rp ${new Intl.NumberFormat("id-ID").format(amount)}`;
}