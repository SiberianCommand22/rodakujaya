import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ensureWallet, toRupiah } from "@/lib/wallet";
import { settleQrisPayment } from "@/lib/settlement";

const METHODS = ["CASH", "QRIS", "RODA_PAY"] as const;
type Method = (typeof METHODS)[number];

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/pay">,
) {
  const user = await getCurrentUser("CUSTOMER");
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id: orderId } = await ctx.params;

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  // Only the customer who booked the trip may settle it.
  if (order.customerId !== user.id) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Pesanan ini bukan milik Anda" },
      { status: 403 },
    );
  }

  if (order.status !== "COMPLETED") {
    return NextResponse.json(
      {
        error: "INVALID_STATE",
        message: "Pembayaran hanya bisa dilakukan setelah perjalanan selesai",
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const method = raw.method as Method;

  if (!METHODS.includes(method)) {
    return NextResponse.json(
      {
        error: "VALIDATION_FAILED",
        details: { method: "method harus CASH, QRIS, atau RODA_PAY" },
      },
      { status: 400 },
    );
  }

  const existing = await db.payment.findUnique({ where: { orderId } });

  // Idempotent: a settled trip returns the stored receipt instead of charging twice.
  if (existing?.status === "PAID") {
    return NextResponse.json({
      payment: {
        id: existing.id,
        orderId: existing.orderId,
        method: existing.method,
        amount: Number(existing.amount),
        status: existing.status,
        paidAt: existing.paidAt,
      },
      alreadyPaid: true,
    });
  }

  const paidAt = new Date();

  // RodaPay debits the wallet and records the receipt in one unit of work, so a
  // failure can never leave the customer charged without a payment row, or a
  // payment row without the matching debit.
  if (method === "RODA_PAY") {
    await ensureWallet(user.id);

    try {
      const result = await db.$transaction(async (tx) => {
        // Re-read inside the transaction: two concurrent requests can both pass
        // the up-front check, and only one of them may debit the wallet.
        const settled = await tx.payment.findUnique({ where: { orderId } });
        if (settled?.status === "PAID") {
          return {
            outcome: "already-paid" as const,
            balance: null,
            payment: settled,
          };
        }

        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId: user.id },
        });

        const fare = new Prisma.Decimal(order.fare);
        const balance = new Prisma.Decimal(wallet.balance);

        if (balance.lessThan(fare)) {
          return {
            outcome: "insufficient" as const,
            balance: toRupiah(balance),
            required: toRupiah(fare),
            payment: null,
          };
        }

        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: balance.minus(fare) },
        });

        const payment = await tx.payment.upsert({
          where: { orderId },
          update: { method, amount: fare, status: "PAID", paidAt },
          create: { orderId, method, amount: fare, status: "PAID", paidAt },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount: fare,
            type: "PAYMENT",
            description: `Pembayaran perjalanan #${orderId.slice(-8).toUpperCase()}`,
            txRef: `RODAPAY-${orderId}`,
          },
        });

        return {
          outcome: "paid" as const,
          balance: toRupiah(updated.balance),
          payment,
        };
      });

      if (result.outcome === "insufficient") {
        return NextResponse.json(
          {
            error: "INSUFFICIENT_BALANCE",
            message: "Saldo RodaPay tidak mencukupi",
            balance: result.balance,
            required: result.required,
          },
          { status: 400 },
        );
      }

      return NextResponse.json({
        payment: {
          id: result.payment.id,
          orderId: result.payment.orderId,
          method: result.payment.method,
          amount: toRupiah(result.payment.amount),
          status: result.payment.status,
          paidAt: result.payment.paidAt,
        },
        alreadyPaid: result.outcome === "already-paid",
        balance: result.balance,
      });
    } catch (error) {
      // P2002 pada txRef `RODAPAY-{orderId}` = balapan ganda yang sudah
      // dimenangkan pihak lain → perlakukan idempoten, jangan 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const settled = await db.payment.findUnique({ where: { orderId } });
        if (settled?.status === "PAID") {
          return NextResponse.json({
            payment: {
              id: settled.id,
              orderId: settled.orderId,
              method: settled.method,
              amount: toRupiah(settled.amount),
              status: settled.status,
              paidAt: settled.paidAt,
            },
            alreadyPaid: true,
            balance: null,
          });
        }
      }
      console.error(`[pay] gagal memproses RodaPay untuk order ${orderId}`, error);
      return NextResponse.json(
        { error: "PAYMENT_FAILED", message: "Pembayaran RodaPay gagal diproses" },
        { status: 500 },
      );
    }
  }

  // QRIS 100%: settlement resmi dengan bagi hasil 20/80 otomatis.
  if (method === "QRIS") {
    const result = await settleQrisPayment(orderId);
    if (result.outcome !== "settled") {
      return NextResponse.json(
        { error: result.outcome.toUpperCase(), message: "Settlement QRIS gagal" },
        { status: 409 },
      );
    }
    return NextResponse.json({
      // Decimal is not JSON-serialisable; expose a plain number for the client.
      payment: {
        id: result.paymentId,
        orderId: result.orderId,
        method: "QRIS",
        amount: result.amount,
        status: "PAID",
        paidAt,
      },
      alreadyPaid: result.alreadyPaid,
      settlement: {
        amount: result.amount,
        platformFee: result.platformFee,
        driverShare: result.driverShare,
      },
    });
  }

  const payment = await db.payment.upsert({
    where: { orderId },
    update: {
      method,
      amount: new Prisma.Decimal(order.fare),
      status: "PAID",
      paidAt,
    },
    create: {
      orderId,
      method,
      amount: new Prisma.Decimal(order.fare),
      status: "PAID",
      paidAt,
    },
  });

  return NextResponse.json({
    // Decimal is not JSON-serialisable; expose a plain number for the client.
    payment: {
      id: payment.id,
      orderId: payment.orderId,
      method: payment.method,
      amount: Number(payment.amount),
      status: payment.status,
      paidAt: payment.paidAt,
    },
    alreadyPaid: false,
  });
}