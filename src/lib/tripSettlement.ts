/**
 * Pure rules for the trip settlement modal.
 *
 * The review step is deliberately modelled here rather than inline in the
 * component: "a review only exists if the customer actively chose a star" is a
 * product rule that must be verifiable, and this module is what the verification
 * suite asserts against.
 */

/** A rating the customer explicitly picked, or null for "not chosen yet". */
export type SelectedRating = 1 | 2 | 3 | 4 | 5 | null;

export type ReviewPayload = {
  rating: number;
  comment?: string;
  tags?: string[];
};

const MAX_COMMENT = 500;

/** Tag apresiasi yang bisa dipilih pelanggan setelah perjalanan lunas. */
export const REVIEW_TAGS = [
  "Driver Ramah",
  "Tepat Waktu",
  "Berkendara Aman",
  "Kendaraan Bersih",
] as const;

export type ReviewTag = (typeof REVIEW_TAGS)[number];

/**
 * Builds the `/review` request body.
 *
 * Returns null when no star was selected — the caller must then skip the request
 * entirely rather than sending a placeholder score. That is what keeps a default
 * rating from polluting the driver's average.
 */
export function buildReviewPayload(
  rating: SelectedRating,
  comment: string,
  tags?: readonly string[],
): ReviewPayload | null {
  if (rating === null) return null;

  const trimmed = comment.trim().slice(0, MAX_COMMENT);
  const picked = (tags ?? []).filter((t) => REVIEW_TAGS.includes(t as ReviewTag));
  return {
    rating,
    ...(trimmed.length > 0 ? { comment: trimmed } : {}),
    ...(picked.length > 0 ? { tags: [...new Set(picked)] } : {}),
  };
}

/** "Kirim Ulasan & Selesai" is only enabled once a star is picked. */
export function canSubmitReview(rating: SelectedRating): boolean {
  return rating !== null;
}

/** Narrows an arbitrary value to a starrable rating. */
export function toSelectedRating(value: unknown): SelectedRating {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5
    ? (value as 1 | 2 | 3 | 4 | 5)
    : null;
}

/**
 * Index of the next unpaid bill after `currentOrderId` was settled, or null when
 * the queue is drained. The modal uses this to advance without a page refresh.
 */
export function nextQueueIndex<T extends { orderId: string }>(
  queue: readonly T[],
  currentOrderId: string,
): number | null {
  const current = queue.findIndex((item) => item.orderId === currentOrderId);
  if (current === -1) return null;
  const next = current + 1;
  return next < queue.length ? next : null;
}

/** Badge copy for the unpaid queue, or null when there is nothing to queue. */
export function queueBadge(
  index: number,
  total: number,
): { text: string; position: number; total: number } | null {
  if (total <= 1) return null;
  return { text: `Tagihan ${index + 1} dari ${total}`, position: index + 1, total };
}