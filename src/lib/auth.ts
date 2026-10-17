import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { db } from "./db";

/**
 * Isolasi sesi multi-tab: tiap portal menyimpan tokennya di cookie sendiri
 * sehingga Pelanggan (/), Driver (/driver), dan Admin (/admin) bisa login
 * bersamaan dalam satu browser tanpa saling menimpa sesi.
 */
export const SESSION_COOKIES = {
  CUSTOMER: "rodaku_customer_session",
  DRIVER: "rodaku_driver_session",
  ADMIN: "rodaku_admin_session",
} as const;

export type PortalRole = keyof typeof SESSION_COOKIES;

/** Cookie lawas pra-isolasi — hanya dibaca sebagai fallback migrasi. */
export const SESSION_COOKIE = "rodaku_session";

/** Header yang dikirim klien untuk menegaskan portal asalnya. */
export const PORTAL_HEADER = "x-rodaku-portal";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SCRYPT_KEYLEN = 64;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "DRIVER" | "ADMIN";
  phone: string | null;
  googleId: string | null;
  avatar: string | null;
  driver: {
    id: string;
    plateNumber: string;
    vehicleType: string;
    vehicleBrand: string | null;
    isOnline: boolean;
    isBlocked: boolean;
  } | null;
};

export function portalCookieName(portal: PortalRole): string {
  return SESSION_COOKIES[portal];
}

/** Tebak portal dari header eksplisit, lalu path/referer URL. */
export function detectPortal(request?: Request): PortalRole | null {
  if (!request) return null;
  const header = request.headers.get(PORTAL_HEADER)?.toUpperCase();
  if (header === "CUSTOMER" || header === "DRIVER" || header === "ADMIN") {
    return header;
  }
  const url = new URL(request.url);
  const haystack = `${url.pathname} ${request.headers.get("referer") ?? ""}`;
  if (haystack.includes("/admin")) return "ADMIN";
  if (haystack.includes("/driver")) return "DRIVER";
  return null;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId,
      token,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { token } });
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

/** Tulis cookie sesi milik portal sesuai role — tidak menyentuh portal lain. */
export async function setSessionCookie(token: string, role: SessionUser["role"]) {
  const store = await cookies();
  store.set(SESSION_COOKIES[role], token, { ...COOKIE_OPTIONS });
}

/** Hapus cookie sesi satu portal, atau semuanya bila tanpa argumen. */
export async function clearSessionCookie(role?: SessionUser["role"]) {
  const store = await cookies();
  if (role) {
    store.delete(SESSION_COOKIES[role]);
    return;
  }
  for (const name of Object.values(SESSION_COOKIES)) store.delete(name);
  store.delete(SESSION_COOKIE);
}

function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  role: SessionUser["role"];
  phone: string | null;
  googleId: string | null;
  avatar: string | null;
  driver: {
    id: string;
    plateNumber: string;
    vehicleType: string;
    vehicleBrand: string | null;
    isOnline: boolean;
    isBlocked: boolean;
  } | null;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
    googleId: user.googleId ?? null,
    avatar: user.avatar ?? null,
    driver: user.driver
      ? {
          id: user.driver.id,
          plateNumber: user.driver.plateNumber,
          vehicleType: user.driver.vehicleType,
          vehicleBrand: user.driver.vehicleBrand ?? null,
          isOnline: user.driver.isOnline,
          isBlocked: user.driver.isBlocked,
        }
      : null,
  };
}

async function resolveToken(token: string): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { token },
    include: { user: { include: { driver: true } } },
  });

  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }

  return toSessionUser(session.user);
}

/**
 * Ambil sesi aktif untuk satu portal.
 *
 * - `portal` eksplisit (atau terdeteksi dari request) → cookie portal itu
 *   diutamakan; cookie lawas hanya diterima bila role-nya cocok (migrasi).
 * - Tanpa portal → kembalikan sesi valid pertama dari cookie mana pun
 *   (dipakai endpoint netral seperti /api/auth/me).
 */
export async function getCurrentUser(
  portalOrRequest?: PortalRole | Request | null,
  maybeRequest?: Request,
): Promise<SessionUser | null> {
  // Session expiry is inherently request-time; opt into dynamic rendering so
  // Cache Components does not try to prerender the `Date.now()` comparison.
  await connection();

  let portal: PortalRole | null = null;
  let request: Request | undefined;
  if (typeof portalOrRequest === "string") {
    portal = portalOrRequest;
    request = maybeRequest ?? undefined;
  } else if (portalOrRequest instanceof Request) {
    request = portalOrRequest;
  }
  if (!portal && request) portal = detectPortal(request);

  const store = await cookies();
  const read = (name: string) => store.get(name)?.value ?? null;

  if (portal) {
    const token = read(SESSION_COOKIES[portal]);
    if (token) {
      const user = await resolveToken(token);
      // Token portal lain yang nyasar tidak boleh dipakai lintas portal.
      if (user && user.role === portal) return user;
    }
    // Migrasi: cookie lawas masih sah bila role-nya sesuai portal ini.
    const legacy = read(SESSION_COOKIE);
    if (legacy) {
      const user = await resolveToken(legacy);
      if (user && user.role === portal) return user;
    }
    return null;
  }

  for (const name of [...Object.values(SESSION_COOKIES), SESSION_COOKIE]) {
    const token = read(name);
    if (!token) continue;
    const user = await resolveToken(token);
    if (user) return user;
  }
  return null;
}

export function publicUser(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
    googleId: user.googleId ?? null,
    avatar: user.avatar ?? null,
    driver: user.driver,
  };
}
