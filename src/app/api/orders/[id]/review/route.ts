import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

const MAX_COMMENT = 500;
const MAX_TAGS = 4;
const MAX_TAG_LENGTH = 30;
const ROUND_TO = 2;

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/orders/[id]/review">,
) {
  const user = await getCurrentUser("CUSTOMER");
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id: orderId } = await ctx.params;

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  if (order.customerId !== user.id) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Pesanan ini bukan milik Anda" },
      { status: 403 },
    );
  }

  if (order.status !== "COMPLETED") {
    return NextResponse.json(
      { error: "INVALID_STATE", message: "Ulasan hanya untuk perjalanan selesai" },
      { status: 409 },
    );
  }

  if (!order.driverId) {
    return NextResponse.json(
      { error: "NO_DRIVER", message: "Pesanan tidak memiliki driver" },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const rating = typeof raw.rating === "number" ? raw.rating : Number(raw.rating);
  const commentRaw = raw.comment;
  const comment =
    typeof commentRaw === "string" ? commentRaw.trim().slice(0, MAX_COMMENT) : null;
  const tagsRaw = raw.tags;
  const tags = Array.isArray(tagsRaw)
    ? [...new Set(
        tagsRaw
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim().slice(0, MAX_TAG_LENGTH))
          .filter((t) => t.length > 0),
      )].slice(0, MAX_TAGS)
    : [];

  if (!Number.isFinite(rating) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json(
      {
        error: "VALIDATION_FAILED",
        details: { rating: "rating harus bilangan bulat 1 sampai 5" },
      },
      { status: 400 },
    );
  }

  const driverId = order.driverId;

  // Recompute the driver's aggregate from the reviews table inside one
  // transaction so the stored average always matches the review set.
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.review.findUnique({ where: { orderId } });
    if (existing) {
      return { duplicate: true as const, review: existing, ratingAvg: null, totalTrips: null };
    }

    const review = await tx.review.create({
      data: {
        orderId,
        customerId: user.id,
        driverId,
        rating,
        comment: comment && comment.length > 0 ? comment : null,
        tags: tags.length > 0 ? JSON.stringify(tags) : null,
      },
    });

    const agg = await tx.review.aggregate({
      where: { driverId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const ratingAvg = Number((agg._avg.rating ?? 0).toFixed(ROUND_TO));
    const totalTrips = agg._count.rating;

    await tx.driver.update({
      where: { id: driverId },
      data: { ratingAvg, totalTrips },
    });

    return { duplicate: false as const, review, ratingAvg, totalTrips };
  });

  if (result.duplicate) {
    return NextResponse.json(
      { error: "ALREADY_REVIEWED", message: "Ulasan untuk pesanan ini sudah ada" },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      review: {
        id: result.review.id,
        orderId: result.review.orderId,
        rating: result.review.rating,
        comment: result.review.comment,
        tags: result.review.tags,
        createdAt: result.review.createdAt,
      },
      driver: { ratingAvg: result.ratingAvg, totalTrips: result.totalTrips },
    },
    { status: 201 },
  );
}