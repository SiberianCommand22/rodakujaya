import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * GET /api/driver/orders/available — pesanan SEARCHING yang belum bertuan.
 * Dipolling konsol driver tiap 3 detik sebagai jaring pengaman Socket.io
 * `order:new`, sehingga pesanan pelanggan tidak pernah terlewat.
 */
export async function GET() {
  const user = await getCurrentUser("DRIVER");
  if (!user) {
    // Bedakan jelas: tanpa sesi sama sekali → 401; ada sesi non-driver
    // (mis. pelanggan mengintip) → 403.
    const anySession = await getCurrentUser();
    if (anySession) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Akun bukan mitra driver" },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!user.driver) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Akun bukan mitra driver" },
      { status: 403 },
    );
  }
  if (user.driver.isBlocked) {
    return NextResponse.json({ error: "DRIVER_BLOCKED" }, { status: 403 });
  }

  const cutoff = new Date(Date.now() - 10 * 60_000);

  // Bersihkan otomatis pesanan SEARCHING kadaluarsa (>10 menit) setiap kali
  // driver online / polling, agar antrean tidak menumpuk.
  try {
    await db.order.updateMany({
      where: { status: "SEARCHING", createdAt: { lt: cutoff } },
      data: { status: "CANCELLED", cancelReason: "Kadaluarsa: tidak ada driver menerima dalam 10 menit." },
    });
  } catch {
    /* best-effort */
  }

  const orders = await db.order.findMany({
    where: { status: "SEARCHING", createdAt: { gte: cutoff } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      vehicleType: o.vehicleType,
      pickupLat: o.pickupLat,
      pickupLng: o.pickupLng,
      pickupAddress: o.pickupAddress,
      dropoffLat: o.dropoffLat,
      dropoffLng: o.dropoffLng,
      dropoffAddress: o.dropoffAddress,
      distanceKm: o.distanceKm,
      fare: o.fare,
      driverNote: o.driverNote,
      createdAt: o.createdAt,
    })),
  });
}
