import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ensureWallet, serializeWallet, toRupiah } from "@/lib/wallet";
import {
  MIN_WITHDRAWAL_AMOUNT,
  newTxRef,
  newWithdrawalTxHash,
  sanitizeAccountNumber,
  sanitizeBankName,
} from "@/lib/financeSecurity";

function readString(value: unknown, max = 64): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t || t.length > max) return null;
  return t;
}

/**
 * GET /api/driver/withdraw — saldo dompet + riwayat pencairan milik driver.
 */
export async function GET() {
  const user = await getCurrentUser("DRIVER");
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!user.driver) {
    return NextResponse.json({ error: "FORBIDDEN", message: "Akun bukan mitra driver" }, { status: 403 });
  }
  if (user.driver.isBlocked) {
    return NextResponse.json({ error: "DRIVER_BLOCKED", message: "Akun Mitra ditangguhkan." }, { status: 403 });
  }

  const wallet = await ensureWallet(user.id);
  const withdrawals = await db.withdrawalRequest.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    wallet: {
      ...serializeWallet(wallet, []),
      balance: toRupiah(wallet.balance),
      lockedBalance: toRupiah(wallet.lockedBalance),
      availableBalance: toRupiah(wallet.balance),
    },
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      amount: toRupiah(w.amount),
      bankName: w.bankName,
      accountNumber: w.accountNumber,
      accountName: w.accountName,
      status: w.status,
      note: w.note,
      createdAt: w.createdAt,
    })),
    minWithdrawal: MIN_WITHDRAWAL_AMOUNT,
  });
}

/**
 * POST /api/driver/withdraw — pengajuan pencairan dana.
 * Body: { amount, bankName, accountNumber, accountName, idempotencyKey? }
 *
 * Anti race-condition: seluruh cek + debit + lock berjalan dalam SATU
 * db.$transaction. Saldo aktif dikurangi dan dipindah ke lockedBalance,
 * sehingga tembakan ganda simultan tidak bisa mencairkan dua kali.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser("DRIVER");
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!user.driver) {
    return NextResponse.json({ error: "FORBIDDEN", message: "Akun bukan mitra driver" }, { status: 403 });
  }
  if (user.driver.isBlocked) {
    return NextResponse.json({ error: "DRIVER_BLOCKED", message: "Akun Mitra ditangguhkan." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const amount = typeof raw.amount === "string" ? Number(raw.amount) : raw.amount;
  const bankName = sanitizeBankName(raw.bankName);
  const accountNumber = sanitizeAccountNumber(raw.accountNumber);
  const accountName = readString(raw.accountName, 80);
  const idempotencyKey =
    typeof raw.idempotencyKey === "string" && raw.idempotencyKey.trim().length >= 8
      ? raw.idempotencyKey.trim().slice(0, 64)
      : null;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { amount: "Nominal harus positif" } },
      { status: 400 },
    );
  }
  const rounded = Math.round(amount);
  if (rounded < MIN_WITHDRAWAL_AMOUNT) {
    return NextResponse.json(
      {
        error: "BELOW_MINIMUM",
        message: `Minimum penarikan Rp ${MIN_WITHDRAWAL_AMOUNT.toLocaleString("id-ID")}`,
        minWithdrawal: MIN_WITHDRAWAL_AMOUNT,
      },
      { status: 400 },
    );
  }
  if (!bankName) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { bankName: "Bank tidak didukung (BCA, BRI, BNI, MANDIRI, JAGO, WISE, PAYPAL)" } },
      { status: 400 },
    );
  }
  if (!accountNumber) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { accountNumber: "Nomor rekening tidak valid" } },
      { status: 400 },
    );
  }
  if (!accountName) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { accountName: "Nama pemilik wajib diisi" } },
      { status: 400 },
    );
  }

  try {
    // Replay dengan kunci yang sama → kembalikan pengajuan yang sudah ada.
    if (idempotencyKey) {
      const dupe = await db.withdrawalRequest.findUnique({ where: { txHash: idempotencyKey } });
      if (dupe) {
        return NextResponse.json({
          withdrawal: {
            id: dupe.id,
            amount: toRupiah(dupe.amount),
            bankName: dupe.bankName,
            accountNumber: dupe.accountNumber,
            accountName: dupe.accountName,
            status: dupe.status,
          },
          alreadyProcessed: true,
        });
      }
    }

    const result = await db.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: user.id } });
      const balance = new Prisma.Decimal(wallet.balance);

      if (balance.lessThan(rounded)) {
        return {
          outcome: "insufficient" as const,
          balance: toRupiah(balance),
          lockedBalance: toRupiah(wallet.lockedBalance),
        };
      }

      const fare = new Prisma.Decimal(rounded);
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: balance.minus(fare),
          lockedBalance: new Prisma.Decimal(wallet.lockedBalance).plus(fare),
        },
      });

      const withdrawal = await tx.withdrawalRequest.create({
        data: {
          walletId: wallet.id,
          driverId: user.driver!.id,
          amount: fare,
          bankName,
          accountNumber,
          accountName,
          status: "PENDING",
          txHash: idempotencyKey ?? newWithdrawalTxHash(),
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: fare,
          type: "WITHDRAWAL_LOCK",
          description: `Penarikan ${bankName} ${accountNumber} dikunci menunggu admin`,
          txRef: newTxRef(`WD-LOCK-${withdrawal.id.slice(-6).toUpperCase()}`),
        },
      });

      return { outcome: "created" as const, updated, withdrawal };
    });

    if (result.outcome === "insufficient") {
      return NextResponse.json(
        {
          error: "INSUFFICIENT_BALANCE",
          message: "Saldo aktif tidak mencukupi",
          balance: result.balance,
          lockedBalance: result.lockedBalance,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        message: "Pengajuan penarikan dibuat. Menunggu persetujuan admin.",
        withdrawal: {
          id: result.withdrawal.id,
          amount: toRupiah(result.withdrawal.amount),
          bankName: result.withdrawal.bankName,
          accountNumber: result.withdrawal.accountNumber,
          accountName: result.withdrawal.accountName,
          status: result.withdrawal.status,
          createdAt: result.withdrawal.createdAt,
        },
        wallet: {
          balance: toRupiah(result.updated.balance),
          lockedBalance: toRupiah(result.updated.lockedBalance),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "DUPLICATE_REQUEST", message: "Pengajuan ganda terdeteksi — gunakan data yang sudah ada." },
        { status: 409 },
      );
    }
    console.error("[driver/withdraw] gagal memproses penarikan", error);
    return NextResponse.json(
      { error: "WITHDRAWAL_FAILED", message: "Pengajuan penarikan gagal diproses." },
      { status: 500 },
    );
  }
}
