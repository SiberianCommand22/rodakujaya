import { NextResponse } from "next/server";

/**
 * QRIS verify removed for pure P2P bank-transfer payments.
 * Stub kept so stale clients receive a clear 410 instead of a confusing 404.
 */
export async function POST() {
  return NextResponse.json(
    { error: "REMOVED", message: "QRIS sudah tidak digunakan. Bayar langsung ke rekening driver." },
    { status: 410 },
  );
}
