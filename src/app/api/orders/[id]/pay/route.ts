import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { claimBankTransfer, completeCashOrder } from "@/lib/settlement";

const METHODS = ["CASH", "BANK_TRANSFER"] as const;
type Method = (typeof METHODS)[number];

/**
 * POST /api/orders/[id]/pay
 *
 * Customer settles the trip after it ends:
 * - CASH → order completes immediately, no digital payment record lifecycle.
 * - BANK_TRANSFER → Payment row is created/updated to CLAIMED ("Saya Sudah
 *   Transfer"); the order stays AWAITING_PAYMENT until the driver confirms.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/pay">,
) {
  const user = await getCurrentUser("CUSTOMER");
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id: orderId } = await ctx.params;

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });
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
        details: { method: "method harus CASH atau BANK_TRANSFER" },
      },
      { status: 400 },
    );
  }

  // Idempotent: already-paid trips return the stored receipt.
  if (order.payment?.status === "PAID") {
    return NextResponse.json({
      payment: serializePayment(order.payment),
      alreadyPaid: true,
    });
  }

  if (method === "CASH") {
    if (order.status !== "ON_TRIP" && order.status !== "AWAITING_PAYMENT") {
      return NextResponse.json(
        {
          error: "INVALID_STATE",
          message: "Pembayaran hanya bisa dilakukan setelah perjalanan selesai",
        },
        { status: 409 },
      );
    }
    await completeCashOrder(orderId);
    const payment = await db.payment.findUnique({ where: { orderId } });
    return NextResponse.json({
      payment: payment ? serializePayment(payment) : null,
      alreadyPaid: false,
    });
  }

  // BANK_TRANSFER: customer claims they have transferred to the driver's
  // bank account. Order must be in AWAITING_PAYMENT (set when the trip ends).
  const result = await claimBankTransfer(orderId, user.id);
  if (result.outcome === "not-found") {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }
  if (result.outcome === "forbidden") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Pesanan ini bukan milik Anda" },
      { status: 403 },
    );
  }
  if (result.outcome === "invalid-state") {
    return NextResponse.json(
      {
        error: "INVALID_STATE",
        message: "Transfer hanya bisa diklaim setelah perjalanan selesai",
      },
      { status: 409 },
    );
  }

  const payment = await db.payment.findUnique({ where: { orderId } });
  return NextResponse.json({
    payment: payment ? serializePayment(payment) : null,
    alreadyClaimed: result.outcome === "already-claimed",
  });
}

function serializePayment(payment: {
  id: string;
  orderId: string;
  method: string;
  amount: unknown;
  status: string;
  paidAt: Date | null;
  claimedAt: Date | null;
  bankName: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
}) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    method: payment.method,
    amount: Number(payment.amount),
    status: payment.status,
    paidAt: payment.paidAt,
    claimedAt: payment.claimedAt,
    bankName: payment.bankName,
    accountNumber: payment.accountNumber,
    accountHolderName: payment.accountHolderName,
  };
}
