import { NextResponse } from "next/server";

/**
 * Withdrawal flow removed for pure P2P bank-transfer payments.
 * Drivers receive money directly from customers — no wallet, no withdrawal.
 * Stub kept so stale clients receive a clear 410 instead of a confusing 404.
 */
export async function GET() {
  return NextResponse.json(
    { error: "REMOVED", message: "Pencairan sudah tidak digunakan. Pembayaran masuk langsung ke rekening Anda." },
    { status: 410 },
  );
}

export async function POST() {
  return NextResponse.json(
    { error: "REMOVED", message: "Pencairan sudah tidak digunakan. Pembayaran masuk langsung ke rekening Anda." },
    { status: 410 },
  );
}
