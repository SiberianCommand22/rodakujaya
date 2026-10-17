import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureWallet, toRupiah } from "@/lib/wallet";
import { QRIS_WINDOW_SECONDS, buildQrisString, shortTxRef } from "@/lib/qris";

/** Komisi platform 20% — tercatat di ringkasan /admin. */
export const PLATFORM_FEE_BPS = 2_000; // basis poin: 20%
/** Tipe ledger untuk kredit bagi hasil driver. */
export const DRIVER_EARNING_TYPE = "EARNING";

export type QrisInvoice = {
  orderId: string;
  txRef: string;
  amount: number;
  discount: number;
  promoCode: string | null;
  qrisString: string;
  expiresAt: string;
};

function invoiceExpiry(payment: { updatedAt: Date; createdAt: Date }): string {
  const base = (payment.updatedAt ?? payment.createdAt).getTime();
  return new Date(base + QRIS_WINDOW_SECONDS * 1000).toISOString();
}

/**
 * Menerbitkan (atau memakai ulang) invoice QRIS PENDING untuk satu order.
 * Idempoten: order yang sudah PAID langsung dilaporkan lunas.
 */
export async function createQrisInvoice(orderId: string, customerId: string) {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return { outcome: "not-found" as const };
  if (order.customerId !== customerId) return { outcome: "forbidden" as const };
  if (order.status !== "COMPLETED") return { outcome: "invalid-state" as const };

  const existing = await db.payment.findUnique({ where: { orderId } });
  if (existing?.status === "PAID") {
    return {
      outcome: "already-paid" as const,
      payment: existing,
      invoice: toInvoice(order, existing),
    };
  }

  const fare = new Prisma.Decimal(order.fare);
  const payment = await db.payment.upsert({
    where: { orderId },
    update: { method: "QRIS", amount: fare, status: "PENDING", paidAt: null },
    create: { orderId, method: "QRIS", amount: fare, status: "PENDING" },
  });

  return { outcome: "created" as const, payment, invoice: toInvoice(order, payment) };
}

function toInvoice(
  order: { id: string; fare: number; discount: number; promoCode: string | null },
  payment: { updatedAt: Date; createdAt: Date },
): QrisInvoice {
  const amount = toRupiah(order.fare);
  return {
    orderId: order.id,
    txRef: shortTxRef(order.id),
    amount,
    discount: order.discount ?? 0,
    promoCode: order.promoCode,
    qrisString: buildQrisString({ orderId: order.id, amount }),
    expiresAt: invoiceExpiry(payment),
  };
}

export type QrisSettlement = {
  paymentId: string;
  orderId: string;
  amount: number;
  /** 20% komisi platform dalam rupiah. */
  platformFee: number;
  /** 80% hak driver dalam rupiah. */
  driverShare: number;
  alreadyPaid: boolean;
};

/**
 * Mengonfirmasi pelunasan QRIS: Payment → PAID, 80% tarif dikreditkan ke
 * dompet Mitra Driver (idempoten), 20% tercatat sebagai komisi platform yang
 * diagregasi di /admin dari tabel Payment.
 *
 * Keamanan:
 * - Nominal SELALU dari order.fare di DB (bukan input browser) → anti fare tampering.
 * - Idempotent: Payment PAID dikembalikan apa adanya; kredit driver memakai
 *   txRef unik `QRIS-EARNING-{txRef}` sehingga retry webhook/verify ganda
 *   tidak menggandakan saldo (P2002 → dianggap sudah diproses).
 * - Seluruh mutasi dalam db.$transaction (ACID) → anti race condition.
 */
export async function settleQrisPayment(orderId: string): Promise<
  | { outcome: "not-found" }
  | { outcome: "invalid-state" }
  | { outcome: "no-driver" }
  | ({ outcome: "settled" } & QrisSettlement)
> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return { outcome: "not-found" };
  if (order.status !== "COMPLETED") return { outcome: "invalid-state" };
  if (!order.driverId) return { outcome: "no-driver" };

  // Nominal dikunci dari server: hitung ulang dari DB, abaikan payload klien.
  const fare = toRupiah(order.fare);
  if (!Number.isFinite(fare) || fare <= 0) return { outcome: "invalid-state" };
  const platformFee = Math.round((fare * PLATFORM_FEE_BPS) / 10_000);
  const driverShare = fare - platformFee;
  const paidAt = new Date();
  const txRef = shortTxRef(order.id);
  const earningTxRef = `QRIS-EARNING-${txRef}`;
  const earningMarker = `Bagi hasil QRIS #${txRef}`;

  const result = await db.$transaction(async (tx) => {
    const current = await tx.payment.findUnique({ where: { orderId } });
    if (current?.status === "PAID") {
      return { alreadyPaid: true, payment: current };
    }

    const payment = await tx.payment.upsert({
      where: { orderId },
      update: { method: "QRIS", amount: new Prisma.Decimal(fare), status: "PAID", paidAt },
      create: {
        orderId,
        method: "QRIS",
        amount: new Prisma.Decimal(fare),
        status: "PAID",
        paidAt,
      },
    });

    // Kredit driver idempoten: txRef unik + fallback marker per order agar retry
    // webhook / verify ganda tidak menggandakan saldo.
    const driver = await tx.driver.findUnique({ where: { id: order.driverId! } });
    if (!driver) return { alreadyPaid: false, payment };

    const wallet = await tx.wallet.upsert({
      where: { userId: driver.userId },
      update: {},
      create: { userId: driver.userId, balance: new Prisma.Decimal(0) },
    });

    if (driverShare > 0) {
      const dupe =
        (await tx.walletTransaction.findUnique({ where: { txRef: earningTxRef } }).catch(() => null)) ??
        (await tx.walletTransaction.findFirst({
          where: { walletId: wallet.id, type: DRIVER_EARNING_TYPE, description: earningMarker },
        }));
      if (!dupe) {
        try {
          const balance = new Prisma.Decimal(wallet.balance);
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: balance.plus(driverShare) },
          });
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              amount: new Prisma.Decimal(driverShare),
              type: DRIVER_EARNING_TYPE,
              description: `${earningMarker} — order #${order.id.slice(-8).toUpperCase()}`,
              txRef: earningTxRef,
            },
          });
        } catch (txError) {
          // Balapan dua settlement bersamaan: P2002 = pihak lain menang duluan.
          if (
            txError instanceof Prisma.PrismaClientKnownRequestError &&
            txError.code === "P2002"
          ) {
            // Sudah dikredit — lanjut sebagai idempoten.
          } else {
            throw txError;
          }
        }
      }
    }

    return { alreadyPaid: false, payment };
  });

  return {
    outcome: "settled",
    paymentId: result.payment.id,
    orderId,
    amount: fare,
    platformFee,
    driverShare,
    alreadyPaid: result.alreadyPaid,
  };
}

/** Memastikan dompet driver ada (dipakai endpoint status driver). */
export async function ensureDriverWallet(driverUserId: string) {
  return ensureWallet(driverUserId);
}
