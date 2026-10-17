import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  WELCOME_BALANCE,
  type WalletSnapshot,
} from "@/lib/walletContract";

export {
  WELCOME_BALANCE,
  TOPUP_OPTIONS,
  MIN_WITHDRAWAL,
  WITHDRAWAL_BANKS,
  isValidTopupAmount,
  type WalletSnapshot,
  type WalletTransactionType,
  type WalletTransactionView,
} from "@/lib/walletContract";

/**
 * Decimal → number for JSON responses.
 *
 * SQLite has no native DECIMAL, so the value round-trips through REAL. Amounts are
 * integral rupiah, but `Math.round` guards against 9999.999999 float dust leaking
 * into the UI or a fare comparison.
 */
export function toRupiah(value: Prisma.Decimal | number): number {
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Returns the caller's wallet, creating it on first access.
 *
 * Registration already opens the wallet, so this is a safety net for accounts
 * that predate the RodaPay feature and for concurrent first-time calls; the
 * upsert keeps both races harmless.
 */
export async function ensureWallet(userId: string) {
  return db.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId, balance: new Prisma.Decimal(WELCOME_BALANCE) },
  });
}

/** Latest mutations for the wallet ledger, newest first. */
export function recentTransactions(walletId: string, take = 5) {
  return db.walletTransaction.findMany({
    where: { walletId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** JSON shape returned by GET /api/wallet and POST /api/wallet/topup. */
export function serializeWallet(
  wallet: { id: string; balance: Prisma.Decimal; lockedBalance?: Prisma.Decimal | number | null },
  transactions: {
    id: string;
    amount: Prisma.Decimal;
    type: string;
    description: string;
    createdAt: Date;
  }[],
): WalletSnapshot {
  const balance = toRupiah(wallet.balance);
  const locked = wallet.lockedBalance == null ? 0 : toRupiah(wallet.lockedBalance as Prisma.Decimal);
  return {
    id: wallet.id,
    balance,
    lockedBalance: locked,
    availableBalance: balance,
    transactions: transactions.map((t) => ({
      id: t.id,
      amount: toRupiah(t.amount),
      type: t.type,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}