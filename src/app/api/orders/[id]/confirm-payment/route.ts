import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { confirmBankTransfer } from "@/lib/settlement";

/**
 * POST /api/orders/[id]/confirm-payment
 *
 * Driver confirms the P2P bank transfer was received in their m-banking.
 * Moves Payment → PAID and Order → COMPLETED. Driver earns 100% of the fare.
 */
export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/orders/[id]/confirm-payment">,
) {
  const user = await getCurrentUser("DRIVER");
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!user.driver) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Akun bukan mitra driver" },
      { status: 403 },
    );
  }

  const { id: orderId } = await ctx.params;

  const result = await confirmBankTransfer(orderId, user.id);
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
        message:
          "Pembayaran hanya bisa dikonfirmasi setelah pelanggan mengklaim transfer",
      },
      { status: 409 },
    );
  }

  const payment = await db.payment.findUnique({ where: { orderId } });
  return NextResponse.json({
    payment: payment
      ? {
          id: payment.id,
          orderId: payment.orderId,
          method: payment.method,
          amount: Number(payment.amount),
          status: payment.status,
          paidAt: payment.paidAt,
        }
      : null,
    driverEarning: result.driverEarning,
    message: "Pembayaran diterima. Perjalanan selesai.",
  });
}
