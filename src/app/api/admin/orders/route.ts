import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/** Pembatalan darurat order yang sedang berjalan oleh admin. */
export async function PATCH(request: Request) {
  const user = await getCurrentUser("ADMIN");
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN", message: "Hanya admin." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const raw = (body ?? {}) as Record<string, unknown>;
  const orderId = typeof raw.orderId === "string" ? raw.orderId.trim() : "";
  if (!orderId) {
    return NextResponse.json({ error: "orderId wajib diisi" }, { status: 400 });
  }

  const existing = await db.order.findUnique({ where: { id: orderId } });
  if (!existing) {
    return NextResponse.json({ error: "Order tidak ditemukan" }, { status: 404 });
  }
  if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
    return NextResponse.json({ error: "Order sudah selesai." }, { status: 409 });
  }

  const order = await db.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
  return NextResponse.json({ order, message: "Pesanan dibatalkan darurat oleh admin." });
}
