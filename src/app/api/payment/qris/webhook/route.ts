import { NextResponse } from "next/server";

/**
 * QRIS webhook disabled for pure P2P bank-transfer payments.
 * No third-party gateway calls this anymore; returning 410 makes any
 * residual webhook traffic fail loudly rather than silently.
 */
export async function POST() {
  return NextResponse.json(
    { error: "REMOVED", message: "QRIS webhook dinonaktifkan." },
    { status: 410 },
  );
}
