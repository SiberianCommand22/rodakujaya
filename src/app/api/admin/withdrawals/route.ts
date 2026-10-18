import { NextResponse } from "next/server";

/**
 * Withdrawal approval removed for pure P2P bank-transfer payments.
 * Stub kept so stale clients receive a clear 410 instead of a confusing 404.
 */
export async function GET() {
  return NextResponse.json(
    { error: "REMOVED", message: "Pencairan sudah tidak digunakan." },
    { status: 410 },
  );
}
