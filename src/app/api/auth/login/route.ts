import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createSession,
  publicUser,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { authLimiter, rateLimitResponse } from "@/lib/rateLimit";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const email =
    typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  const password = typeof raw.password === "string" ? raw.password : "";

  // Rate limit on both the IP and the targeted email so an attacker cannot
  // bypass the cap by rotating accounts from one host.
  const limit = authLimiter(request, email);
  if (!limit.allowed) {
    return rateLimitResponse(
      limit,
      "Terlalu banyak percobaan login. Coba lagi sebentar lagi.",
    );
  }

  if (!email || !password) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", details: { email: "email dan password wajib diisi" } },
      { status: 400 },
    );
  }

  const user = await db.user.findUnique({
    where: { email },
    include: { driver: true },
  });

  // Constant-ish work on both branches to avoid user enumeration by timing.
  const stored = user?.password ?? "0000:0000";
  const valid = verifyPassword(password, stored);

  if (!user || !valid) {
    return NextResponse.json(
      { error: "INVALID_CREDENTIALS", message: "Email atau password salah" },
      { status: 401 },
    );
  }

  // Mitra yang ditangguhkan administrator tidak boleh masuk sama sekali.
  if (user.driver?.isBlocked) {
    return NextResponse.json(
      {
        error: "DRIVER_BLOCKED",
        message: "Akun Mitra Anda sedang ditangguhkan/diblokir oleh Administrator.",
      },
      { status: 403 },
    );
  }

  const token = await createSession(user.id);
  await setSessionCookie(token, user.role);

  return NextResponse.json({
    user: publicUser({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      phone: user.phone,
      googleId: user.googleId ?? null,
      avatar: user.avatar ?? null,
      bankName: user.bankName ?? null,
      accountNumber: user.accountNumber ?? null,
      accountHolderName: user.accountHolderName ?? null,
      driver: user.driver
        ? {
            id: user.driver.id,
            plateNumber: user.driver.plateNumber,
            vehicleType: user.driver.vehicleType,
            vehicleBrand: user.driver.vehicleBrand ?? null,
            isOnline: user.driver.isOnline,
            isBlocked: user.driver.isBlocked,
          }
        : null,
    }),
  });
}