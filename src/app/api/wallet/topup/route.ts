import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  ensureWallet,
  isValidTopupAmount,
  recentTransactions,
  serializeWallet,
} from "@/lib/wallet";
import { newTxRef } from "@/lib/financeSecurity";

/** Denominations shown on the top-up buttons in the trip summary modal. */
const DENOMINATIONS = [20_000, 50_000, 100_000] as const;

/**
 * Credits the wallet instantly. This is a pilot flow with no payment gateway
 * behind it, so the amount is restricted to the three fixed denominations to
 * keep the ledger free of arbitrary test noise.
 *
 * Hardening: amount<=0 ditolak; idempotency via `idempotencyKey` opsional
 * (txRef unik) sehingga retry ganda tidak menggandakan saldo.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser("CUSTOMER");
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const amount = typeof raw.amount === "string" ? Number(raw.amount) : raw.amount;

  if (typeof amount === "number" && amount <= 0) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { amount: "amount harus positif" } },
      { status: 400 },
    );
  }

  if (!isValidTopupAmount(amount)) {
    return NextResponse.json(
      {
        error: "VALIDATION_FAILED",
        details: {
          amount: `amount harus salah satu dari ${DENOMINATIONS.join(", ")}`,
        },
      },
      { status: 400 },
    );
  }

  const idempotencyKey =
    typeof raw.idempotencyKey === "string" && raw.idempotencyKey.trim().length >= 8
      ? raw.idempotencyKey.trim().slice(0, 64)
      : null;

  try {
    await ensureWallet(user.id);

    // Idempotent replay: kunci sudah pernah diproses → kembalikan state kini.
    if (idempotencyKey) {
      const dupe = await db.walletTransaction.findUnique({
        where: { txRef: idempotencyKey },
      });
      if (dupe) {
        const wallet = await db.wallet.findUniqueOrThrow({ where: { userId: user.id } });
        const transactions = await recentTransactions(wallet.id, 5);
        return NextResponse.json({
          wallet: serializeWallet(wallet, transactions),
          topupAmount: amount,
          alreadyProcessed: true,
        });
      }
    }

    // Balance update and ledger row are one atomic unit: a crash can never leave
    // a credited balance without the matching transaction, or vice versa.
    const wallet = await db.$transaction(async (tx) => {
      const current = await tx.wallet.findUniqueOrThrow({
        where: { userId: user.id },
      });

      const updated = await tx.wallet.update({
        where: { id: current.id },
        data: { balance: new Prisma.Decimal(current.balance).plus(amount) },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: current.id,
          amount: new Prisma.Decimal(amount),
          type: "TOPUP",
          description: `Top-up RodaPay ${new Intl.NumberFormat("id-ID").format(amount)}`,
          txRef: idempotencyKey ?? newTxRef("TOPUP"),
        },
      });

      return updated;
    });

    const transactions = await recentTransactions(wallet.id, 5);

    return NextResponse.json({
      wallet: serializeWallet(wallet, transactions),
      topupAmount: amount,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Balapan idempotencyKey bersamaan: anggap sudah diproses.
      try {
        const wallet = await db.wallet.findUniqueOrThrow({ where: { userId: user.id } });
        const transactions = await recentTransactions(wallet.id, 5);
        return NextResponse.json({
          wallet: serializeWallet(wallet, transactions),
          topupAmount: amount,
          alreadyProcessed: true,
        });
      } catch {
        /* jatuh ke 500 generik di bawah */
      }
    }
    console.error("[wallet/topup] gagal top-up", error);
    return NextResponse.json(
      { error: "TOPUP_FAILED", message: "Top-up gagal diproses. Coba lagi." },
      { status: 500 },
    );
  }
}
