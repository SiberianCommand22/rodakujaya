import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { orderLimiter, rateLimitResponse } from "@/lib/rateLimit";
import {
  isValidCoordinate,
  type OrderStatus,
  type VehicleType,
} from "@/lib/utils";
import { fareForRoute, getRoute } from "@/lib/routing";
import { applyPromo, normalizePromoCode } from "@/lib/promo";

const MAX_ADDRESS_LENGTH = 200;
const MAX_PRICE = 10_000_000;
const MAX_NOTE_LENGTH = 200;

type FieldErrors = Record<string, string>;

function badRequest(errors: FieldErrors) {
  return NextResponse.json({ error: "VALIDATION_FAILED", details: errors }, { status: 400 });
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ADDRESS_LENGTH) return null;
  return trimmed;
}

function readNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

function readCoordinate(lat: unknown, lng: unknown) {
  const parsedLat = readNumber(lat);
  const parsedLng = readNumber(lng);
  if (parsedLat === null || parsedLng === null) return null;
  if (!isValidCoordinate({ lat: parsedLat, lng: parsedLng })) return null;
  return { lat: parsedLat, lng: parsedLng };
}

async function requireCustomer() {
  const user = await getCurrentUser("CUSTOMER");
  if (!user) return null;
  if (user.role !== "CUSTOMER" && user.role !== "ADMIN") return null;
  return user;
}

export async function POST(request: Request) {
  const customer = await requireCustomer();
  if (!customer) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Silakan login sebagai pelanggan" },
      { status: 401 },
    );
  }

  const limit = orderLimiter(request, customer.id);
  if (!limit.allowed) {
    return rateLimitResponse(
      limit,
      "Terlalu banyak permintaan pesanan. Coba lagi sebentar lagi.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const errors: FieldErrors = {};

  const pickup = readCoordinate(raw.pickupLat, raw.pickupLng);
  const dropoff = readCoordinate(raw.dropLat ?? raw.dropoffLat, raw.dropLng ?? raw.dropoffLng);
  const pickupAddr = readString(raw.pickupAddr ?? raw.pickupAddress);
  const dropoffAddr = readString(raw.dropAddr ?? raw.dropoffAddress);
  const vehicleType = raw.vehicleType;
  const price = readNumber(raw.price ?? raw.fare);
  const driverNoteRaw = raw.driverNote;
  const driverNote =
    typeof driverNoteRaw === "string" && driverNoteRaw.trim().length > 0
      ? driverNoteRaw.trim().slice(0, MAX_NOTE_LENGTH)
      : null;

  if (!pickup) errors.pickup = "pickupLat/pickupLng tidak valid";
  if (!dropoff) errors.drop = "dropLat/dropLng tidak valid";
  if (!pickupAddr) errors.pickupAddr = "pickupAddr wajib diisi";
  if (!dropoffAddr) errors.dropAddr = "dropAddr wajib diisi";
  if (vehicleType !== "RODA_MOTOR" && vehicleType !== "RODA_MOBIL") {
    errors.vehicleType = "vehicleType harus RODA_MOTOR atau RODA_MOBIL";
  }
  if (price === null || price <= 0 || price > MAX_PRICE) {
    errors.price = "price harus angka positif";
  }

  if (Object.keys(errors).length > 0) return badRequest(errors);
  if (!pickup || !dropoff) return badRequest({ body: "koordinat tidak valid" });

  // Price from the shared routing engine, which also serves GET /api/routing.
// The cache means the OSRM call that priced the quote is reused here.
const route = await getRoute(pickup, dropoff);
const distanceKm = route.distanceKm;
const expectedFare = fareForRoute(route, vehicleType as VehicleType);

  // Voucher opsional: server menghitung ulang diskon dari tarif penuh agar
  // klien tidak bisa memalsukan potongan harga.
  const promoCode = normalizePromoCode(raw.promoCode ?? null);
  const promo = applyPromo(expectedFare, promoCode);
  const claimedDiscountRaw = readNumber(raw.discountAmount ?? 0) ?? 0;
  const claimedDiscount = Math.round(claimedDiscountRaw);

  if (raw.promoCode !== undefined && raw.promoCode !== null && String(raw.promoCode).trim() !== "" && !promo) {
    return badRequest({ promoCode: "Kode promo tidak dikenal. Coba RODAHEMAT atau RODABARU." });
  }
  if (promo && claimedDiscount !== promo.discount) {
    return badRequest({
      discountAmount: `discountAmount tidak sesuai hitungan server (${promo.discount})`,
    });
  }
  if (!promo && claimedDiscount !== 0) {
    return badRequest({ discountAmount: "discountAmount harus 0 tanpa kode promo" });
  }

  const finalFare = promo ? promo.total : expectedFare;

  if (Math.abs(finalFare - (price as number)) > 1) {
    return badRequest({
      price: `price tidak sesuai tarif terhitung (${finalFare})`,
    });
  }

  // Bersihkan antrean sampah: batalkan otomatis pesanan SEARCHING >10 menit
  // agar tidak menumpuk di layar driver saat pesanan baru dibuat.
  try {
    await db.order.updateMany({
      where: {
        status: "SEARCHING",
        createdAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      data: { status: "CANCELLED", cancelReason: "Kadaluarsa: tidak ada driver menerima dalam 10 menit." },
    });
  } catch {
    /* best-effort */
  }

  const order = await db.order.create({
    data: {
      customerId: customer.id,
      vehicleType: vehicleType as VehicleType,
      status: "SEARCHING",
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      pickupAddress: pickupAddr,
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      dropoffAddress: dropoffAddr,
      distanceKm,
      fare: finalFare,
      promoCode: promo ? promo.code : null,
      discount: promo ? promo.discount : 0,
      driverNote,
      durationMin: route.durationMinutes,
      routeSource: route.source,
    },
  });

  return NextResponse.json({ order }, { status: 201 });
}

const ACTIVE_STATUSES = ["SEARCHING", "ACCEPTED", "PICKING_UP", "ON_TRIP"] as const;

const ORDER_INCLUDE = {
  driver: { include: { user: { select: { name: true } } } },
  payment: true,
  review: true,
} as const;

export async function GET(request: Request) {
  const customer = await requireCustomer();
  if (!customer) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Silakan login terlebih dahulu" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), 100)
    : 20;

  const [active, recent] = await Promise.all([
    db.order.findMany({
      where: { customerId: customer.id, status: { in: [...ACTIVE_STATUSES] } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: ORDER_INCLUDE,
    }),
    db.order.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: ORDER_INCLUDE,
    }),
  ]);

  // Finished trips the customer still has to settle (or rate), oldest first so
  // the modal can walk the queue in a stable, explainable order.
  const pending = recent
    .filter((o) => o.status === "COMPLETED" && o.payment?.status !== "PAID")
    .reverse();

  const pendingSettlements = pending.map((o) => ({
    orderId: o.id,
    fare: o.fare,
    needsReview: !o.review,
  }));

  return NextResponse.json({
    active,
    recent,
    count: recent.length,
    // Kept for clients that only need the head of the queue.
    pendingSettlement: pendingSettlements[0]
      ? {
          orderId: pendingSettlements[0].orderId,
          needsReview: pendingSettlements[0].needsReview,
        }
      : null,
    pendingSettlements,
  });
}

const VALID_STATUSES: OrderStatus[] = [
  "SEARCHING",
  "ACCEPTED",
  "PICKING_UP",
  "ON_TRIP",
  "COMPLETED",
  "CANCELLED",
];

/** Persists a lifecycle transition emitted by the Socket.io layer. */
export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const orderId = typeof raw.orderId === "string" ? raw.orderId.trim() : "";
  const status = raw.status as OrderStatus;
  const cancelReasonRaw = raw.cancelReason;
  const cancelReason =
    typeof cancelReasonRaw === "string" && cancelReasonRaw.trim().length > 0
      ? cancelReasonRaw.trim().slice(0, MAX_NOTE_LENGTH)
      : null;

  if (!orderId) {
    return NextResponse.json({ error: "orderId wajib diisi" }, { status: 400 });
  }
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "status tidak valid" }, { status: 400 });
  }

  const existing = await db.order.findUnique({ where: { id: orderId } });
  if (!existing) {
    return NextResponse.json({ error: "order tidak ditemukan" }, { status: 404 });
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Pembatalan oleh pelanggan pemilik order (atau admin) selalu diizinkan
  // selama order belum selesai. Ini dipakai tombol "Batalkan Pesanan".
  if (status === "CANCELLED") {
    if (user.role === "ADMIN") {
      const order = await db.order.update({
        where: { id: orderId },
        data: { status, ...(cancelReason ? { cancelReason } : {}) },
      });
      return NextResponse.json({ order });
    }
    const owned = await db.order.findFirst({
      where: { id: orderId, customerId: user.id },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Hanya pemilik pesanan yang dapat membatalkan" },
        { status: 403 },
      );
    }
    if (owned.status === "COMPLETED" || owned.status === "CANCELLED") {
      return NextResponse.json(
        { error: "CONFLICT", message: "Pesanan sudah selesai dan tidak bisa dibatalkan" },
        { status: 409 },
      );
    }
    const order = await db.order.update({
      where: { id: orderId },
      data: { status, ...(cancelReason ? { cancelReason } : {}) },
    });
    return NextResponse.json({ order });
  }

  if (!user.driver) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Hanya mitra driver yang dapat mengubah status" },
      { status: 403 },
    );
  }

  const lat = readNumber(raw.lat);
  const lng = readNumber(raw.lng);
  const point =
    lat !== null && lng !== null && isValidCoordinate({ lat, lng })
      ? { lat, lng }
      : null;

  // Terminal states cannot be reopened; ACCEPTED is the only claimable state.
  if (status === "ACCEPTED" && existing.status !== "SEARCHING") {
    return NextResponse.json(
      { error: "CONFLICT", message: "Pesanan sudah diambil driver lain" },
      { status: 409 },
    );
  }

  if (point) {
    await db.driver.update({
      where: { id: user.driver.id },
      data: { lastLat: point.lat, lastLng: point.lng },
    });
  }

  const order = await db.order.update({
    where: { id: orderId },
    data: {
      status,
      ...(status === "ACCEPTED" ? { driverId: user.driver.id } : {}),
    },
  });

  return NextResponse.json({ order });
}
