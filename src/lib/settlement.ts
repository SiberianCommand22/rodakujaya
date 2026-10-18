import { db } from "@/lib/db";
import { toRupiah } from "@/lib/wallet";

/**
 * Peer-to-peer direct bank transfer settlement.
 *
 * Platform takes 0% commission — driver keeps 100% of the fare. There is no
 * wallet, no QRIS gateway, and no automatic payout. The customer transfers
 * directly to the driver's bank account, claims the transfer in-app, and the
 * driver confirms receipt from their own m-banking before marking the order
 * COMPLETED.
 */

export const PLATFORM_FEE_BPS = 0; // 0% — pure P2P, no platform commission

export type BankDetails = {
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
};

export type ClaimResult =
  | { outcome: "ok"; paymentId: string }
  | { outcome: "not-found" }
  | { outcome: "forbidden" }
  | { outcome: "invalid-state" }
  | { outcome: "already-claimed" };

export type ConfirmResult =
  | { outcome: "ok"; paymentId: string; driverEarning: number }
  | { outcome: "not-found" }
  | { outcome: "forbidden" }
  | { outcome: "invalid-state" };

/** Fetch the driver's bank details for an order, if registered. */
export async function getDriverBankDetails(
  orderId: string,
): Promise<BankDetails | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      driver: { include: { user: {
        select: { bankName: true, accountNumber: true, accountHolderName: true },
      } } },
    },
  });
  if (!order?.driver?.user.bankName || !order.driver.user.accountNumber) return null;
  return {
    bankName: order.driver.user.bankName,
    accountNumber: order.driver.user.accountNumber,
    accountHolderName: order.driver.user.accountHolderName ?? order.driver.user.bankName,
  };
}

/**
 * Customer taps "Saya Sudah Transfer" after the trip. Moves Payment from
 * PENDING → CLAIMED and snapshots the driver's bank details onto the payment.
 */
export async function claimBankTransfer(
  orderId: string,
  customerId: string,
): Promise<ClaimResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { payment: true, driver: { include: { user: true } } },
  });
  if (!order) return { outcome: "not-found" };
  if (order.customerId !== customerId) return { outcome: "forbidden" };
  if (order.status !== "AWAITING_PAYMENT") return { outcome: "invalid-state" };
  if (order.payment?.status === "CLAIMED") return { outcome: "already-claimed" };
  if (order.payment?.status === "PAID") return { outcome: "invalid-state" };

  const bank = order.driver?.user;
  if (!bank?.bankName || !bank.accountNumber) return { outcome: "invalid-state" };

  const payment = await db.payment.upsert({
    where: { orderId },
    create: {
      orderId,
      method: "BANK_TRANSFER",
      amount: order.fare,
      status: "CLAIMED",
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      accountHolderName: bank.accountHolderName ?? bank.name,
      claimedAt: new Date(),
    },
    update: {
      status: "CLAIMED",
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      accountHolderName: bank.accountHolderName ?? bank.name,
      claimedAt: new Date(),
    },
  });

  return { outcome: "ok", paymentId: payment.id };
}

/**
 * Driver verifies the transfer in their m-banking, then taps
 * "Konfirmasi Pembayaran Diterima". Moves Payment → PAID and Order → COMPLETED.
 * Driver earns 100% of the fare (PLATFORM_FEE_BPS = 0).
 */
export async function confirmBankTransfer(
  orderId: string,
  driverUserId: string,
): Promise<ConfirmResult> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { payment: true, driver: { include: { user: true } } },
  });
  if (!order) return { outcome: "not-found" };
  if (order.driver?.user.id !== driverUserId) return { outcome: "forbidden" };
  if (order.status !== "AWAITING_PAYMENT") return { outcome: "invalid-state" };
  if (order.payment?.status !== "CLAIMED") return { outcome: "invalid-state" };

  const fare = order.fare;
  const platformFee = Math.round((fare * PLATFORM_FEE_BPS) / 10_000);
  const driverEarning = fare - platformFee;

  await db.$transaction([
    db.payment.update({
      where: { orderId },
      data: { status: "PAID", paidAt: new Date() },
    }),
    db.order.update({
      where: { id: orderId },
      data: { status: "COMPLETED" },
    }),
  ]);

  return { outcome: "ok", paymentId: order.payment.id, driverEarning };
}

/**
 * CASH path: complete the order immediately with no payment record lifecycle.
 * Kept for parity with the old pay route — order moves ON_TRIP → COMPLETED.
 */
export async function completeCashOrder(orderId: string): Promise<void> {
  await db.$transaction([
    db.payment.upsert({
      where: { orderId },
      create: { orderId, method: "CASH", amount: 0, status: "PAID", paidAt: new Date() },
      update: { method: "CASH", status: "PAID", paidAt: new Date() },
    }),
    db.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } }),
  ]);
}

export { toRupiah };
