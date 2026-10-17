import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  if (typeof raw.isOnline !== "boolean") {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { isOnline: "isOnline harus boolean" } },
      { status: 400 },
    );
  }

  // Akun yang diblokir tidak boleh kembali online.
  if (raw.isOnline === true) {
    const current = await db.driver.findUnique({ where: { id: user.driver.id } });
    if (current?.isBlocked) {
      return NextResponse.json(
        {
          error: "DRIVER_BLOCKED",
          message: "Akun Mitra Anda sedang ditangguhkan/diblokir oleh Administrator.",
        },
        { status: 403 },
      );
    }
  }

  const driver = await db.driver.update({
    where: { id: user.driver.id },
    data: { isOnline: raw.isOnline },
  });

  return NextResponse.json({ isOnline: driver.isOnline });
}