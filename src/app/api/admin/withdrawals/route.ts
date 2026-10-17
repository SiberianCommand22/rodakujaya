import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { toRupiah } from "@/lib/wallet";
import { newTxRef } from "@/lib/financeSecurity";

function readString(value: unknown, max = 64): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t || t.length > max) return null;
  return t;
}

/**
 * GET /api/admin/withdrawals — daftar pengajuan pencairan (khusus ADMIN).
 * Query: ?status=PENDING|APPROVED|REJECTED (opsional)
 */
export async function GET(request: Request) {
  const user = await getCurrentUser("ADMIN");
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN", message: "Halaman khusus administrator." }, { status: 403 });
  }

  const statusParam = new URL(request.url).searchParams.get("status")?.toUpperCase();
  const where =
    statusParam === "PENDING" || statusParam === "APPROVED" || statusParam === "REJECTED"
      ? { status: statusParam as "PENDING" | "APPROVED" | "REJECTED" }
      : {};

  const rows = await db.withdrawalRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Sertakan nama driver untuk tampilan admin.
  const driverIds = [...new Set(rows.map((r) => r.driverId))];
  const drivers = await db.driver.findMany({
    where: { id: { in: driverIds } },
    include: { user: { select: { name: true, email: true, phone: true } } },
  });
  const driverMap = new Map(drivers.map((d) => [d.id, d]));

  return NextResponse.json({
    withdrawals: rows.map((w) => ({
      id: w.id,
      amount: toRupiah(w.amount),
      bankName: w.bankName,
      accountNumber: w.accountNumber,
      accountName: w.accountName,
      status: w.status,
      note: w.note,
      txHash: w.txHash,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      driver: driverMap.get(w.driverId)
        ? {
            id: w.driverId,
            name: driverMap.get(w.driverId)!.user.name,
            email: driverMap.get(w.driverId)!.user.email,
            phone: driverMap.get(w.driverId)!.user.phone,
          }
        : { id: w.driverId, name: "-", email: "-", phone: null },
    })),
  });
}

/**
 * PATCH /api/admin/withdrawals — setujui/tolak pencairan (khusus ADMIN).
 * Body: { withdrawalId, action: "APPROVED"|"REJECTED", note? }
 *
 * - APPROVED: lockedBalance dipotong permanen + ledger WITHDRAWAL_SUCCESS.
 * - REJECTED: lockedBalance dikembalikan penuh ke balance.
 * - Idempoten: withdrawal yang sudah diputus dikembalikan apa adanya.
 */
export async function PATCH(request: Request) {
  const user = await getCurrentUser("ADMIN");
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN", message: "Halaman khusus administrator." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const withdrawalId = readString(raw.withdrawalId, 64);
  const action = typeof raw.action === "string" ? raw.action.toUpperCase() : null;
  const note = readString(raw.note, 280);

  if (!withdrawalId) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { withdrawalId: "withdrawalId wajib diisi" } },
      { status: 400 },
    );
  }
  if (action !== "APPROVED" && action !== "REJECTED") {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { action: "action harus APPROVED atau REJECTED" } },
      { status: 400 },
    );
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.withdrawalRequest.findUnique({ where: { id: withdrawalId } });
      if (!existing) return { outcome: "not-found" as const };
      if (existing.status !== "PENDING") {
        return { outcome: "already-decided" as const, withdrawal: existing };
      }

      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: existing.walletId } });
      const amount = new Prisma.Decimal(existing.amount);
      if (amount.lessThanOrEqualTo(0)) return { outcome: "invalid-amount" as const };

      const locked = new Prisma.Decimal(wallet.lockedBalance);
      if (locked.lessThan(amount)) return { outcome: "lock-mismatch" as const };

      if (action === "APPROVED") {
        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: { lockedBalance: locked.minus(amount) },
        });
        const withdrawal = await tx.withdrawalRequest.update({
          where: { id: existing.id },
          data: { status: "APPROVED", ...(note ? { note } : {}) },
        });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount,
            type: "WITHDRAWAL_SUCCESS",
            description: `Penarikan ${existing.bankName} ${existing.accountNumber} disetujui admin`,
            txRef: newTxRef(`WD-OK-${existing.id.slice(-6).toUpperCase()}`),
          },
        });
        return { outcome: "decided" as const, withdrawal, wallet: updated };
      }

      // REJECTED — kembalikan penuh ke saldo aktif.
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          lockedBalance: locked.minus(amount),
          balance: new Prisma.Decimal(wallet.balance).plus(amount),
        },
      });
      const withdrawal = await tx.withdrawalRequest.update({
        where: { id: existing.id },
        data: { status: "REJECTED", ...(note ? { note } : {}) },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount,
          type: "WITHDRAWAL_REFUND",
          description: `Penarikan ${existing.bankName} ditolak admin — saldo dikembalikan`,
          txRef: newTxRef(`WD-RF-${existing.id.slice(-6).toUpperCase()}`),
        },
      });
      return { outcome: "decided" as const, withdrawal, wallet: updated };
    });

    if (result.outcome === "not-found") {
      return NextResponse.json({ error: "WITHDRAWAL_NOT_FOUND" }, { status: 404 });
    }
    if (result.outcome === "invalid-amount" || result.outcome === "lock-mismatch") {
      return NextResponse.json(
        { error: "LEDGER_MISMATCH", message: "Data penguncian saldo tidak konsisten. Periksa manual." },
        { status: 409 },
      );
    }
    if (result.outcome === "already-decided") {
      return NextResponse.json({
        withdrawal: {
          id: result.withdrawal.id,
          status: result.withdrawal.status,
          amount: toRupiah(result.withdrawal.amount),
        },
        alreadyDecided: true,
      });
    }

    return NextResponse.json({
      message: action === "APPROVED" ? "Penarikan disetujui." : "Penarikan ditolak, saldo dikembalikan.",
      withdrawal: {
        id: result.withdrawal.id,
        status: result.withdrawal.status,
        amount: toRupiah(result.withdrawal.amount),
        bankName: result.withdrawal.bankName,
        accountNumber: result.withdrawal.accountNumber,
      },
      wallet: {
        balance: toRupiah(result.wallet.balance),
        lockedBalance: toRupiah(result.wallet.lockedBalance),
      },
    });
  } catch (error) {
    console.error("[admin/withdrawals] gagal memutus penarikan", error);
    return NextResponse.json(
      { error: "WITHDRAWAL_DECISION_FAILED", message: "Gagal memproses keputusan admin." },
      { status: 500 },
    );
  }
}
