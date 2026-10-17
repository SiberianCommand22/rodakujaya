import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const ACTIVE_STATUSES = ["ACCEPTED", "PICKING_UP", "ON_TRIP"] as const;

/**
 * Lets the driver console recover after a refresh or a server restart:
 * returns the order currently in progress plus the last GPS fix persisted on
 * the Driver row, so the marker can be placed before live telemetry resumes.
 */
export async function GET() {
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

  const [order, driver] = await Promise.all([
    db.order.findFirst({
      where: { driverId: user.driver.id, status: { in: [...ACTIVE_STATUSES] } },
      orderBy: { updatedAt: "desc" },
    }),
    db.driver.findUnique({ where: { id: user.driver.id } }),
  ]);

  return NextResponse.json({
    order,
    driver: {
      isOnline: driver?.isOnline ?? false,
      isBlocked: driver?.isBlocked ?? false,
      lastLat: driver?.lastLat ?? null,
      lastLng: driver?.lastLng ?? null,
      plateNumber: driver?.plateNumber ?? null,
      ratingAvg: driver?.ratingAvg ?? 5,
      totalTrips: driver?.totalTrips ?? 0,
    },
  });
}