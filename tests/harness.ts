import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { io, type Socket } from "socket.io-client";
import type { PrismaClient } from "@prisma/client";

export const TEST_PORT = Number(process.env.VERIFY_PORT ?? 3199);
export const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
export const SOCKET_URL = BASE_URL;

const TSX_CLI = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ApiResponse<T = Record<string, unknown>> = {
  status: number;
  body: T;
};

let clientSeq = 0;

/**
 * Minimal browser-like client: keeps the session cookie and pins a distinct
 * `x-forwarded-for`, so the suite is not throttled by the per-IP rate limiter.
 */
export class TestClient {
  private readonly cookies = new Map<string, string>();
  readonly ip: string;

  constructor(label: string) {
    this.ip = `10.99.${Math.floor(clientSeq / 250)}.${(clientSeq % 250) + 1}`;
    clientSeq += 1;
    this.label = label;
  }

  readonly label: string;

  async get<T = Record<string, unknown>>(route: string): Promise<ApiResponse<T>> {
    return this.request<T>("GET", route);
  }

  async post<T = Record<string, unknown>>(
    route: string,
    body: unknown = {},
  ): Promise<ApiResponse<T>> {
    return this.request<T>("POST", route, body);
  }

  async request<T = Record<string, unknown>>(
    method: string,
    route: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-forwarded-for": this.ip,
      ...extraHeaders,
    };

    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    }

    const res = await fetch(`${BASE_URL}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }

    return { status: res.status, body: parsed as T };
  }
}

let server: ChildProcess | null = null;

export async function startServer(): Promise<void> {
  server = spawn(process.execPath, [TSX_CLI, "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      NODE_ENV: "development",
    },
    stdio: "pipe",
  });

  const logs: string[] = [];
  server.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    logs.push(text);
    if (process.env.VERIFY_DEBUG) process.stdout.write(`[srv] ${text}`);
  });
  server.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    logs.push(text);
    if (process.env.VERIFY_DEBUG) process.stderr.write(`[srv!] ${text}`);
  });

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server berhenti dini:\n${logs.join("")}`);
    }
    try {
      // 401 proves the Next.js request pipeline and Prisma are both live.
      const res = await fetch(`${BASE_URL}/api/auth/me`);
      if (res.status === 401 || res.ok) return;
    } catch {
      // Not listening yet.
    }
    await delay(500);
  }

  throw new Error(`server tidak siap dalam batas waktu:\n${logs.join("")}`);
}

export async function stopServer(): Promise<void> {
  const child = server;
  server = null;
  if (!child || child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export function connectSocket(): Promise<Socket> {
  const socket = io(SOCKET_URL, {
    transports: ["websocket"],
    path: "/socket.io",
    forceNew: true,
    reconnection: false,
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("socket tidak terhubung dalam batas waktu")),
      15_000,
    );
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Joins `tracking:{orderId}` and waits for the server acknowledgement, so a
 * broadcast issued right after cannot overtake this socket's own join.
 */
export async function joinTrackingRoom(
  socket: Socket,
  orderId: string,
): Promise<void> {
  await socket.emitWithAck("track:order", orderId);
}

/** Resolves with the first `event` payload matching `predicate`, else rejects. */
export function waitForEvent<T>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`tidak menerima "${event}" dalam ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(payload: T) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }

    socket.on(event, handler);
  });
}

/** Asserts that `event` does NOT arrive within the grace window. */
export async function expectNoEvent<T>(
  socket: Socket,
  event: string,
  graceMs = 1500,
): Promise<void> {
  const seen: T[] = [];
  const handler = (payload: T) => {
    seen.push(payload);
  };

  socket.on(event, handler);
  await delay(graceMs);
  socket.off(event, handler);

  if (seen.length > 0) {
    throw new Error(
      `event "${event}" seharusnya tidak dikirim: ${JSON.stringify(seen[0])}`,
    );
  }
}

export type SeededDriver = {
  userId: string;
  driverId: string;
  ratingAvg: number;
  totalTrips: number;
};

export type SeededOrder = {
  id: string;
  fare: number;
};

/**
 * Creates a driver account with bank details so P2P transfers can settle.
 *
 * `ratingAvg`/`totalTrips` are left at the schema defaults on purpose: the review
 * endpoint recomputes both from the Review table, so a fabricated baseline would
 * only hide that behaviour.
 */
export async function seedDriver(db: PrismaClient, label: string): Promise<SeededDriver> {
  const suffix = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const user = await db.user.create({
    data: {
      email: `verify-driver-${suffix}@rodaku.local`,
      name: `Driver Verifikasi ${label}`,
      password: "verify-only",
      role: "DRIVER",
      phone: "08123456789",
      bankName: "BCA",
      accountNumber: `123456${String(Math.floor(Math.random() * 1e6)).padStart(4, "0")}`,
      accountHolderName: `Driver Verifikasi ${label}`,
      driver: {
        create: { plateNumber: `B 9${label.slice(0, 3).toUpperCase()} VER` },
      },
    },
    include: { driver: true },
  });

  if (!user.driver) throw new Error("driver seed gagal dibuat");
  return {
    userId: user.id,
    driverId: user.driver.id,
    ratingAvg: user.driver.ratingAvg,
    totalTrips: user.driver.totalTrips,
  };
}

/**
 * Writes a trip straight to Postgres.
 *
 * Driving a real trip through the simulator takes ~30s of wall clock per order;
 * the pay/review endpoints only care about the persisted state, so seeding it
 * keeps the suite fast while still exercising the real HTTP handlers.
 */
export async function seedOrder(
  db: PrismaClient,
  opts: {
    customerId: string;
    driverId: string;
    fare: number;
    status?:
      | "COMPLETED"
      | "ON_TRIP"
      | "ACCEPTED"
      | "PICKING_UP"
      | "AWAITING_PAYMENT";
    createdAt?: Date;
  },
): Promise<SeededOrder> {
  const status = opts.status ?? "COMPLETED";
  const order = await db.order.create({
    data: {
      customerId: opts.customerId,
      driverId: opts.driverId,
      vehicleType: "RODA_MOTOR",
      status,
      pickupLat: -6.2,
      pickupLng: 106.8,
      pickupAddress: "Jl. Test Jemput",
      dropoffLat: -6.21,
      dropoffLng: 106.81,
      dropoffAddress: "Jl. Test Tujuan",
      distanceKm: 2.5,
      fare: opts.fare,
      durationMin: 12,
      routeSource: "FALLBACK",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });

  return { id: order.id, fare: order.fare };
}

/** Shared bank payload for registration helpers. */
export const BANK_FIELDS = {
  bankName: "BCA",
  accountNumber: "1234567890",
  accountHolderName: "Pengguna Verifikasi",
} as const;
