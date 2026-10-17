import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toRupiah } from "@/lib/wallet";
import { verifyQrisWebhookSignature } from "@/lib/financeSecurity";
import { settleQrisPayment } from "@/lib/settlement";

/**
 * POST /api/payment/qris/webhook — callback pelunasan dari switch/acquirer.
 * Body: { orderId, status?: "PAID" | "PENDING" | "FAILED", txRef?, amount? }
 *
 * Keamanan produksi: lindungi dengan HMAC-SHA256 dari acquirer
 * (header `x-callback-signature` atas payload `orderId.STATUS.amount`
 * dengan secret QRIS_WEBHOOK_SECRET). Tanpa secret (localhost/sandbox),
 * request diterima seperti sebelumnya agar pengujian lokal tetap jalan.
 */
export async function POST(request: Request) {
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

  const status =
    typeof raw.status === "string" ? raw.status.toUpperCase() : "PAID";

  if (status !== "PAID") {
    const payment = await db.payment.findUnique({ where: { orderId } });
    return NextResponse.json({
      acknowledged: true,
      settled: false,
      status: payment?.status ?? "PENDING",
    });
  }

  // Nominal rujukan untuk HMAC diambil MUTLAK dari DB (anti fare tampering):
  // field amount dari klien diabaikan sepenuhnya.
  try {
    const order = await db.order.findUnique({ where: { id: orderId } });
    const amountRef = order ? toRupiah(order.fare) : 0;
    const signature = request.headers.get("x-callback-signature");
    const check = verifyQrisWebhookSignature(orderId, status, amountRef, signature);
    if (!check.ok) {
      return NextResponse.json(
        { error: "INVALID_SIGNATURE", message: "Tanda tangan webhook tidak valid." },
        { status: 401 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "WEBHOOK_FAILED", message: "Gagal memverifikasi webhook." },
      { status: 500 },
    );
  }

  const result = await settleQrisPayment(orderId);
  if (result.outcome === "not-found") {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }
  if (result.outcome === "invalid-state" || result.outcome === "no-driver") {
    const payment = await db.payment.findUnique({ where: { orderId } });
    return NextResponse.json(
      {
        error: result.outcome.toUpperCase(),
        status: payment ? { paymentStatus: payment.status, amount: toRupiah(payment.amount) } : null,
      },
      { status: 409 },
    );
  }

  // Klien socket (pelanggan & driver) mendengarkan `payment:settled` di room
  // tracking:{orderId}; pengirim webhook meneruskannya via socket setelah 200.
  return NextResponse.json({ acknowledged: true, settled: true, settlement: result });
}
