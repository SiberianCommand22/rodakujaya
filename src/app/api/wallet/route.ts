import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  ensureWallet,
  recentTransactions,
  serializeWallet,
} from "@/lib/wallet";

/** Active RodaPay balance plus the five most recent mutations. */
export async function GET() {
  const user = await getCurrentUser("CUSTOMER");
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const wallet = await ensureWallet(user.id);
  const transactions = await recentTransactions(wallet.id, 5);

  return NextResponse.json({ wallet: serializeWallet(wallet, transactions) });
}