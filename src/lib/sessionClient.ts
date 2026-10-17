"use client";

/** Harus sama dengan PORTAL_HEADER di src/lib/auth.ts (duplikat agar ringan di browser). */
const PORTAL_HEADER = "x-rodaku-portal";

export type PortalRole = "CUSTOMER" | "DRIVER" | "ADMIN";

/**
 * Keluar dari satu portal tanpa mencabut sesi portal lain di browser yang sama.
 * Gagal jaringan diabaikan — cookie portal tetap dihapus semampunya server.
 */
export async function portalLogout(portal: PortalRole): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { [PORTAL_HEADER]: portal },
    });
  } catch {
    /* abaikan */
  }
}
