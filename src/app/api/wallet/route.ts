import { NextResponse } from "next/server";

/**
 * Wallet/saldo system removed for pure P2P bank-transfer payments.
 * This route is kept as a stub so stale clients receive a clear 410
 * instead of a confusing 404.
 */
export async function GET() {
  return NextResponse.json(
    { error: "REMOVED", message: "Dompet sudah tidak digunakan. Bayar langsung ke driver." },
    { status: 410 },
  );
}
