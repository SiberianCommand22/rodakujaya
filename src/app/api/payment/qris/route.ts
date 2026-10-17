import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { toRupiah } from "@/lib/wallet";
import { createQrisInvoice } from "@/lib/settlement";
import { buildQrisString, shortTxRef } from "@/lib/qris";

function readOrderId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  return typeof raw.orderId === "string" && raw.orderId.trim().length > 0
    ? raw.orderId.trim()
    : null;
}

/**
 * POST /api/payment/qris — menerbitkan invoice QRIS dinamis (PENDING).
 * Body: { orderId }
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

  const orderId = readOrderId(body);
  if (!orderId) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { orderId: "orderId wajib diisi" } },
      { status: 400 },
    );
  }

  const result = await createQrisInvoice(orderId, user.id);
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
        message: "QRIS hanya bisa diterbitkan setelah perjalanan selesai",
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      invoice: result.invoice,
      alreadyPaid: result.outcome === "already-paid",
    },
    { status: 200 },
  );
}

/**
 * GET /api/payment/qris?orderId=… — status polling untuk modal pembayaran.
 * Mengembalikan ulang string QRIS deterministik + status Payment terkini.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser("CUSTOMER");
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const orderId = new URL(request.url).searchParams.get("orderId")?.trim();
  if (!orderId) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { orderId: "orderId wajib diisi" } },
      { status: 400 },
    );
  }

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }
  if (order.customerId !== user.id) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Pesanan ini bukan milik Anda" },
      { status: 403 },
    );
  }

  const payment = await db.payment.findUnique({ where: { orderId } });
  const amount = toRupiah(order.fare);

  return NextResponse.json({
    orderId,
    txRef: shortTxRef(orderId),
    amount,
    qrisString: buildQrisString({ orderId, amount }),
    payment: payment
      ? {
          method: payment.method,
          amount: toRupiah(payment.amount),
          status: payment.status,
          paidAt: payment.paidAt,
        }
      : null,
  });
}
