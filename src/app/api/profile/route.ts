import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, publicUser } from "@/lib/auth";
import { INDONESIAN_BANKS } from "@/lib/walletContract";
import { normalizePlateNumber, isValidPlateNumber } from "@/lib/utils";

const PHONE_RE = /^(\+62|62|0)[0-9]{8,14}$/;
const ACCOUNT_NUMBER_RE = /^[0-9]{6,20}$/;

function readString(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * Perbarui data profil + rekening bank milik sesi aktif.
 * Dipakai halaman /profile untuk mengganti nomor rekening (kebutuhan #2).
 * Mitra driver juga bisa memperbarui plat nomor kendaraan.
 */
export async function PATCH(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHENTICATED", message: "Silakan masuk terlebih dahulu." },
      { status: 401 },
    );
  }

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
  const errors: Record<string, string> = {};

  const name = raw.name !== undefined ? readString(raw.name, 80) : user.name;
  const phoneRaw = raw.phone !== undefined ? readString(raw.phone, 20) : user.phone;
  const phone = phoneRaw === null && raw.phone !== undefined ? null : phoneRaw ?? user.phone;
  const bankName = raw.bankName !== undefined ? readString(raw.bankName, 60) : user.bankName;
  const accountNumber =
    raw.accountNumber !== undefined
      ? (readString(raw.accountNumber, 20)?.replace(/[\s-]/g, "") ?? null)
      : user.accountNumber;
  const accountHolderName =
    raw.accountHolderName !== undefined
      ? readString(raw.accountHolderName, 100)
      : user.accountHolderName;

  // Driver-specific: plate number
  let plateNumber: string | null = null;
  if (raw.plateNumber !== undefined) {
    const plateRaw = readString(raw.plateNumber, 20);
    if (plateRaw) {
      const normalized = normalizePlateNumber(plateRaw);
      if (!isValidPlateNumber(normalized)) {
        errors.plateNumber = "Format plat nomor tidak valid (contoh: B 1234 ABC).";
      } else {
        plateNumber = normalized;
      }
    } else if (raw.plateNumber !== null && raw.plateNumber !== "") {
      errors.plateNumber = "Plat nomor wajib diisi.";
    }
  }

  if (!name) errors.name = "Nama wajib diisi.";
  if (phone !== null && !PHONE_RE.test(phone.replace(/[\s-]/g, "")))
    errors.phone = "Nomor telepon Indonesia tidak valid (contoh: 081234567890).";
  // Bank fields only validated if explicitly provided (allows drivers to update name/plate without bank)
  if (raw.bankName !== undefined && (!bankName || !(INDONESIAN_BANKS as readonly string[]).includes(bankName)))
    errors.bankName = "Pilih nama bank dari daftar.";
  if (raw.accountNumber !== undefined && (!accountNumber || !ACCOUNT_NUMBER_RE.test(accountNumber)))
    errors.accountNumber = "Nomor rekening 6–20 digit angka.";
  if (raw.accountHolderName !== undefined && !accountHolderName)
    errors.accountHolderName = "Nama pemilik rekening wajib diisi.";

  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { error: "VALIDATION_FAILED", message: "Periksa kembali data profil.", details: errors },
      { status: 400 },
    );
  }

  // Update User fields
  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      name: name!,
      phone,
      ...(raw.bankName !== undefined && { bankName: bankName! }),
      ...(raw.accountNumber !== undefined && { accountNumber: accountNumber! }),
      ...(raw.accountHolderName !== undefined && { accountHolderName: accountHolderName! }),
    },
    include: { driver: true },
  });

  // Update Driver plateNumber if provided and user is a driver
  if (plateNumber && user.driver) {
    await db.driver.update({
      where: { id: user.driver.id },
      data: { plateNumber },
    });
    // Refresh driver relation
    updated.driver = { ...updated.driver!, plateNumber };
  }

  return NextResponse.json({
    user: publicUser({
      ...user,
      name: updated.name,
      phone: updated.phone,
      bankName: updated.bankName,
      accountNumber: updated.accountNumber,
      accountHolderName: updated.accountHolderName,
      driver: updated.driver
        ? {
            ...updated.driver,
            plateNumber: updated.driver.plateNumber,
          }
        : null,
    }),
  });
}
