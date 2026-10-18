import { NextResponse } from "next/server";

/**
 * Top-up removed for pure P2P bank-transfer payments.
 * Stub kept so stale clients receive a clear 410 instead of a confusing 404.
 */
export async function POST() {
  return NextResponse.json(
    { error: "REMOVED", message: "Top-up sudah tidak digunakan." },
    { status: 410 },
  );
}
