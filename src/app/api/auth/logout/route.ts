import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  PORTAL_HEADER,
  SESSION_COOKIES,
  SESSION_COOKIE,
  clearSessionCookie,
  destroySession,
  type PortalRole,
} from "@/lib/auth";

/**
 * Keluar dari sesi portal. Klien mengirim `x-rodaku-portal` agar hanya cookie
 * portal itu yang dicabut (tab portal lain tetap login); tanpa header, semua
 * cookie sesi dibersihkan.
 */
export async function POST(request: Request) {
  const store = await cookies();
  const header = request.headers.get(PORTAL_HEADER)?.toUpperCase();
  const scoped: PortalRole | null =
    header === "CUSTOMER" || header === "DRIVER" || header === "ADMIN" ? header : null;

  const names = scoped ? [SESSION_COOKIES[scoped]] : [...Object.values(SESSION_COOKIES), SESSION_COOKIE];
  for (const name of names) {
    const token = store.get(name)?.value;
    if (token) {
      try {
        await destroySession(token);
      } catch {
        /* sesi mungkin sudah kedaluwarsa — lanjut bersihkan cookie */
      }
    }
  }
  await clearSessionCookie(scoped ?? undefined);

  return NextResponse.json({ ok: true });
}
