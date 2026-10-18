/**
 * Client-safe contract shared by RODAKU UI.
 *
 * Wallet/saldo system removed for pure P2P bank transfer. Only the bank
 * dropdown list remains, shared between registration, onboarding, and profile
 * edit forms. Kept free of Prisma imports so client components can use it
 * without pulling the database driver into the browser bundle.
 */

/** Popular Indonesian banks offered in the registration/onboarding dropdown. */
export const INDONESIAN_BANKS = [
  "BCA",
  "Mandiri",
  "BRI",
  "BNI",
  "BTN",
  "CIMB Niaga",
  "Danamon",
  "BSI",
  "Maybank",
  "OCBC NISP",
  "Permata",
  "Panin",
  "BTPN",
  "Bank Jago",
  "Sea Bank",
  "Allo Bank",
  "Bank Digital BCA",
] as const;

export type IndonesianBank = (typeof INDONESIAN_BANKS)[number];
