import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { DatabaseTimeoutError, db, withDbTimeout } from "@/lib/db";
import { createSession, hashPassword, publicUser, setSessionCookie } from "@/lib/auth";
import { authLimiter, rateLimitResponse } from "@/lib/rateLimit";
import { INDONESIAN_BANKS } from "@/lib/walletContract";
import { isValidPlateNumber, normalizePlateNumber } from "@/lib/utils";

type FieldErrors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^(\+62|62|0)[0-9]{8,14}$/;
const ACCOUNT_NUMBER_RE = /^[0-9]{6,20}$/;

function readString(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "INVALID_JSON", message: "Body request bukan JSON yang valid." },
        { status: 400 },
      );
    }

    const raw = (body ?? {}) as Record<string, unknown>;
    const rawEmail = readString(raw.email);

    const limit = authLimiter(request, rawEmail ?? undefined);
    if (!limit.allowed) {
      return rateLimitResponse(
        limit,
        "Terlalu banyak permintaan pendaftaran. Coba lagi sebentar lagi.",
      );
    }

    const name = readString(raw.name, 80);
    const email = rawEmail?.toLowerCase() ?? null;
    const phone = readString(raw.phone, 20);
    const password = typeof raw.password === "string" ? raw.password : "";
    const role = raw.role === "DRIVER" ? "DRIVER" : "CUSTOMER";
    const rawPlate = readString(raw.vehiclePlate, 20);
    // Normalisasi toleran: "R243567" -> "R 243567", "b1234abc" -> "B 1234 ABC".
    const vehiclePlate = rawPlate ? normalizePlateNumber(rawPlate) : null;
    const vehicleType = raw.vehicleType === "RODA_MOBIL" ? "RODA_MOBIL" : "RODA_MOTOR";
    const vehicleBrand = readString(raw.vehicleBrand, 60);

    // Rekening bank — opsional (simulasi auto-CASH, tanpa transfer bank).
    const bankName = readString(raw.bankName, 60);
    const accountNumber = readString(raw.accountNumber, 20);
    const accountHolderName = readString(raw.accountHolderName, 100);

    const errors: FieldErrors = {};
    if (!name) errors.name = "Nama wajib diisi.";
    if (!email || !EMAIL_RE.test(email)) errors.email = "Alamat email tidak valid.";
    if (!phone || !PHONE_RE.test(phone.replace(/[\s-]/g, "")))
      errors.phone = "Nomor telepon Indonesia tidak valid (contoh: 081234567890).";
    if (password.length < 8) errors.password = "Password minimal 8 karakter.";
    // Validasi bank hanya bila diisi (opsional untuk simulasi).
    if (bankName && !(INDONESIAN_BANKS as readonly string[]).includes(bankName))
      errors.bankName = "Pilih nama bank dari daftar.";
    if (accountNumber && !ACCOUNT_NUMBER_RE.test(accountNumber.replace(/[\s-]/g, "")))
      errors.accountNumber = "Nomor rekening 6–20 digit angka.";
    if (accountNumber && !accountHolderName)
      errors.accountHolderName = "Nama pemilik rekening wajib diisi jika mengisi nomor rekening.";
    if (role === "DRIVER") {
      if (!vehiclePlate || !isValidPlateNumber(vehiclePlate))
        errors.vehiclePlate =
          "Nomor plat tidak valid, contoh: B 1337 RDK. Input tanpa spasi tetap diterima.";
      if (raw.vehicleType !== undefined && raw.vehicleType !== "RODA_MOTOR" && raw.vehicleType !== "RODA_MOBIL")
        errors.vehicleType = "Jenis kendaraan harus RodaMotor atau RodaMobil.";
      if (!vehicleBrand)
        errors.vehicleBrand = "Merek / tipe kendaraan wajib diisi (contoh: Honda Beat).";
    }

    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        { error: "VALIDATION_FAILED", message: "Periksa kembali data pendaftaran.", details: errors },
        { status: 400 },
      );
    }

    let existing;
    try {
      existing = await withDbTimeout(() => db.user.findUnique({ where: { email: email! } }));
    } catch (dbError) {
      const timedOut = dbError instanceof DatabaseTimeoutError;
      console.error("[auth/register] gagal memeriksa email", dbError);
      return NextResponse.json(
        {
          error: timedOut ? "DATABASE_TIMEOUT" : "DATABASE_UNAVAILABLE",
          message: timedOut
            ? "Server sedang lambat merespons. Coba lagi beberapa saat lagi."
            : "Layanan sementara tidak tersedia. Coba lagi sebentar lagi.",
        },
        { status: 503 },
      );
    }
    if (existing) {
      return NextResponse.json(
        { error: "EMAIL_TAKEN", message: "Email sudah terdaftar. Silakan masuk.", details: { email: "email sudah terdaftar" } },
        { status: 409 },
      );
    }

    try {
      const created = await withDbTimeout(() =>
        db.user.create({
          data: {
            name: name!,
            email: email!,
            phone,
            password: hashPassword(password),
            role,
            bankName: bankName,
            accountNumber: accountNumber?.replace(/[\s-]/g, "") ?? null,
            accountHolderName: accountHolderName,
          },
        }),
      );

      let driverRow: { id: string; plateNumber: string; vehicleType: string; vehicleBrand: string | null; isOnline: boolean; isBlocked: boolean } | null = null;
      if (role === "DRIVER") {
        driverRow = await withDbTimeout(() =>
          db.driver.create({
            data: {
              userId: created.id,
              plateNumber: vehiclePlate!,
              vehicleType: vehicleType as "RODA_MOTOR" | "RODA_MOBIL",
              vehicleBrand: vehicleBrand!,
            },
          }),
        );
      }

      const token = await withDbTimeout(() => createSession(created.id));
      await withDbTimeout(() => setSessionCookie(token, created.role));

      return NextResponse.json(
        {
          message: "Pendaftaran berhasil. Selamat datang di RODAKU!",
          user: publicUser({
            id: created.id,
            email: created.email,
            name: created.name,
            role: created.role,
            phone: created.phone,
            googleId: created.googleId ?? null,
            avatar: created.avatar ?? null,
            bankName: created.bankName,
            accountNumber: created.accountNumber,
            accountHolderName: created.accountHolderName,
            driver: driverRow
              ? {
                  id: driverRow.id,
                  plateNumber: driverRow.plateNumber,
                  vehicleType: driverRow.vehicleType,
                  vehicleBrand: driverRow.vehicleBrand,
                  isOnline: driverRow.isOnline,
                  isBlocked: driverRow.isBlocked,
                }
              : null,
          }),
        },
        { status: 201 },
      );
    } catch (dbError) {
      if (dbError instanceof DatabaseTimeoutError) {
        console.error("[auth/register] timeout koneksi database", dbError);
        return NextResponse.json(
          {
            error: "DATABASE_TIMEOUT",
            message: "Server sedang lambat merespons. Coba lagi beberapa saat lagi.",
          },
          { status: 503 },
        );
      }
      if (dbError instanceof Prisma.PrismaClientKnownRequestError && dbError.code === "P2002") {
        return NextResponse.json(
          { error: "EMAIL_TAKEN", message: "Email sudah terdaftar. Silakan masuk.", details: { email: "email sudah terdaftar" } },
          { status: 409 },
        );
      }
      console.error("[auth/register] gagal membuat akun", dbError);
      return NextResponse.json(
        {
          error: "REGISTRATION_FAILED",
          message: "Gagal membuat akun karena kendala database. Coba lagi sebentar lagi.",
          details: dbError instanceof Error ? dbError.message : undefined,
        },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("[auth/register] unexpected error", error);
    return NextResponse.json(
      {
        error: "REGISTRATION_FAILED",
        message: "Terjadi kesalahan tak terduga saat pendaftaran. Coba lagi.",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
