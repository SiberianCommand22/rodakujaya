import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createSession, publicUser, setSessionCookie } from "@/lib/auth";
import { authLimiter, rateLimitResponse } from "@/lib/rateLimit";
import { ensureWallet, serializeWallet, toRupiah } from "@/lib/wallet";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function readString(value: unknown, max = 320): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * Decode payload Google Identity Services (credential JWT) tanpa verifikasi
 * signature — cukup untuk UX localhost. Untuk produksi, verifikasi id_token
 * ke https://oauth2.googleapis.com/tokeninfo atau pakai GOOGLE_CLIENT_ID.
 */
function decodeGoogleCredential(credential: string): {
  email?: string;
  name?: string;
  sub?: string;
  picture?: string;
} | null {
  try {
    const parts = credential.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(json) as {
      email?: string;
      name?: string;
      sub?: string;
      picture?: string;
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;

  // Dukung dua bentuk payload: field eksplisit ATAU credential JWT dari GIS.
  let email = readString(raw.email)?.toLowerCase() ?? null;
  let name = readString(raw.name, 80);
  let googleId = readString(raw.googleId, 120);
  let avatar = readString(raw.avatar, 500);

  const credential =
    typeof raw.credential === "string" ? raw.credential : typeof raw.idToken === "string" ? raw.idToken : null;
  if ((!email || !googleId) && credential) {
    const claims = decodeGoogleCredential(credential);
    if (claims?.email) email = claims.email.trim().toLowerCase();
    if (!name && claims?.name) name = claims.name.trim().slice(0, 80);
    if (!googleId && claims?.sub) googleId = claims.sub.trim();
    if (!avatar && claims?.picture) avatar = claims.picture.trim().slice(0, 500);
  }

  const limit = authLimiter(request, email ?? undefined);
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Terlalu banyak percobaan login. Coba lagi sebentar lagi.");
  }

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", message: "Email Google tidak valid.", details: { email: "email tidak valid" } },
      { status: 400 },
    );
  }
  if (!name) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", message: "Nama Google wajib diisi.", details: { name: "nama wajib diisi" } },
      { status: 400 },
    );
  }

  // Cari user berdasarkan email dulu, lalu googleId (akun lama tanpa googleId).
  let user = await db.user.findUnique({ where: { email }, include: { driver: true } });
  if (!user && googleId) {
    user = await db.user.findFirst({ where: { googleId }, include: { driver: true } });
  }

  if (user?.driver?.isBlocked) {
    return NextResponse.json(
      {
        error: "DRIVER_BLOCKED",
        message: "Akun Mitra Anda sedang ditangguhkan/diblokir oleh Administrator.",
      },
      { status: 403 },
    );
  }

  try {
    if (user) {
      // Akun lama (password) yang login via Google: tautkan googleId + avatar.
      const nextData: { googleId?: string; avatar?: string | null; name?: string } = {};
      if (googleId && user.googleId !== googleId) nextData.googleId = googleId;
      if (avatar && user.avatar !== avatar) nextData.avatar = avatar;
      if (Object.keys(nextData).length > 0) {
        try {
          user = await db.user.update({ where: { id: user.id }, data: nextData, include: { driver: true } });
        } catch (updateError) {
          // googleId bentrok dengan akun lain (unik): pertahankan sesi tanpa menautkan.
          if (updateError instanceof Prisma.PrismaClientKnownRequestError && updateError.code === "P2002") {
            // Lanjut tanpa update — login tetap sah via email.
          } else {
            throw updateError;
          }
        }
      }
    } else {
      // Pendaftar baru via Google: CUSTOMER + wallet sambutan Rp 100.000.
      try {
        user = await db.user.create({
          data: {
            email,
            name,
            password: null,
            role: "CUSTOMER",
            googleId: googleId ?? null,
            avatar: avatar ?? null,
          },
          include: { driver: true },
        });
      } catch (createError) {
        if (createError instanceof Prisma.PrismaClientKnownRequestError && createError.code === "P2002") {
          // Balapan dua request bersamaan: ambil ulang yang menang.
          user = await db.user.findUnique({ where: { email }, include: { driver: true } });
          if (!user && googleId) {
            user = await db.user.findFirst({ where: { googleId }, include: { driver: true } });
          }
          if (!user) throw createError;
        } else {
          throw createError;
        }
      }
    }

    const wallet = await ensureWallet(user.id);
    const balance = toRupiah(wallet.balance);

    const token = await createSession(user.id);
    await setSessionCookie(token, user.role);

    return NextResponse.json({
      message: "Masuk dengan Google berhasil. Selamat datang di RODAKU!",
      user: publicUser({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        phone: user.phone,
        googleId: user.googleId ?? null,
        avatar: user.avatar ?? null,
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
      wallet: serializeWallet(wallet, []),
      balance,
    });
  } catch (error) {
    console.error("[auth/google] gagal login Google", error);
    return NextResponse.json(
      { error: "GOOGLE_AUTH_FAILED", message: "Gagal masuk dengan Google. Coba lagi sebentar lagi." },
      { status: 500 },
    );
  }
}
