import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const LIVE_STATUSES = ["SEARCHING", "ACCEPTED", "PICKING_UP", "ON_TRIP"] as const;

/** Ringkasan operasional + armada + transaksi live untuk portal admin. */
export async function GET() {
  const user = await getCurrentUser("ADMIN");
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED", message: "Silakan login." }, { status: 401 });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Halaman khusus administrator." },
      { status: 403 },
    );
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [ordersToday, onlineDrivers, drivers, liveOrders, turnoverAgg, qrisAgg, qrisCount] = await Promise.all([
    db.order.count({ where: { createdAt: { gte: startOfDay } } }),
    db.driver.count({ where: { isOnline: true } }),
    db.driver.findMany({
      include: { user: { select: { name: true, phone: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.order.findMany({
      where: { status: { in: [...LIVE_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        customer: { select: { name: true } },
        driver: { include: { user: { select: { name: true } } } },
      },
    }),
    db.order.aggregate({
      _sum: { fare: true },
      where: { createdAt: { gte: startOfDay } },
    }),
    // Pelunasan QRIS terkonfirmasi hari ini — basis bagi hasil 20/80.
    db.payment.aggregate({
      _sum: { amount: true },
      where: { method: "QRIS", status: "PAID", paidAt: { gte: startOfDay } },
    }),
    db.payment.count({
      where: { method: "QRIS", status: "PAID", paidAt: { gte: startOfDay } },
    }),
  ]);

  const turnover = turnoverAgg._sum.fare ?? 0;
  const commission = Math.round(turnover * 0.2);
  const qrisTurnover = Number(qrisAgg._sum.amount?.toString() ?? 0);
  const qrisCommission = Math.round(qrisTurnover * 0.2);
  const driverPayout = qrisTurnover - qrisCommission;

  // Driver yang sedang membawa order aktif = on-trip.
  const onTripDriverIds = new Set(
    liveOrders.map((o) => o.driverId).filter((id): id is string => Boolean(id)),
  );

  return NextResponse.json({
    stats: {
      ordersToday,
      onlineDrivers,
      turnover,
      commission,
      qrisPaid: qrisCount,
      qrisTurnover,
      qrisCommission,
      driverPayout,
    },
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.user.name,
      phone: d.user.phone,
      email: d.user.email,
      plateNumber: d.plateNumber,
      vehicleType: d.vehicleType,
      totalTrips: d.totalTrips,
      rating: d.ratingAvg ?? d.rating ?? 5,
      isOnline: d.isOnline,
      isBlocked: d.isBlocked,
      onTrip: onTripDriverIds.has(d.id),
      lastLat: d.lastLat,
      lastLng: d.lastLng,
    })),
    liveOrders: liveOrders.map((o) => ({
      id: o.id,
      status: o.status,
      fare: o.fare,
      distanceKm: o.distanceKm,
      pickupAddress: o.pickupAddress,
      dropoffAddress: o.dropoffAddress,
      customerName: o.customer?.name ?? "-",
      driverName: o.driver?.user?.name ?? null,
      createdAt: o.createdAt,
    })),
  });
}
