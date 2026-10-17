import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * Blokir / aktifkan mitra driver.
 * "Blokir"   = isBlocked=true + paksa offline (isOnline=false).
 * "Aktifkan" = isBlocked=false (driver boleh online kembali).
 */
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
  const driverId = typeof raw.driverId === "string" ? raw.driverId : "";
  const action = raw.action === "activate" ? "activate" : raw.action === "block" ? "block" : null;

  if (!driverId || !action) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", message: "driverId dan action (block/activate) wajib diisi." },
      { status: 400 },
    );
  }

  const driver = await db.driver.update({
    where: { id: driverId },
    data:
      action === "block"
        ? { isBlocked: true, isOnline: false }
        : { isBlocked: false },
  });

  return NextResponse.json({
    driver: { id: driver.id, isBlocked: driver.isBlocked, isOnline: driver.isOnline },
    message: action === "block" ? "Driver diblokir dan dipaksa offline." : "Driver diaktifkan kembali.",
  });
}
