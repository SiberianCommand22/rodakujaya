import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { settleQrisPayment } from "@/lib/settlement";

/**
 * POST /api/payment/qris/verify — konfirmasi pelunasan QRIS oleh pelanggan.
 * Body: { orderId }
 *
 * Pada integrasi acquirer penuh, endpoint ini digantikan callback resmi.
 * Di sini ia memverifikasi status invoice lalu menjalankan settlement
 * 20/80 yang sama persis dengan webhook, sehingga idempoten.
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
  const orderId =
    typeof raw.orderId === "string" && raw.orderId.trim().length > 0
      ? raw.orderId.trim()
      : null;
  if (!orderId) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { orderId: "orderId wajib diisi" } },
      { status: 400 },
    );
  }

  // Hanya pemilik pesanan yang boleh mengonfirmasi pelunasannya.
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

  const result = await settleQrisPayment(orderId);
  if (result.outcome === "not-found") {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }
  if (result.outcome === "invalid-state") {
    return NextResponse.json(
      {
        error: "INVALID_STATE",
        message: "Pembayaran hanya bisa dikonfirmasi setelah perjalanan selesai",
      },
      { status: 409 },
    );
  }
  if (result.outcome === "no-driver") {
    return NextResponse.json(
      { error: "NO_DRIVER", message: "Order belum memiliki driver" },
      { status: 409 },
    );
  }

  return NextResponse.json({ settlement: result });
}
