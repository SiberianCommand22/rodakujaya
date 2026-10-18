export type LatLng = { lat: number; lng: number };

/** A resolved location: coordinates plus its human-readable address. */
export type Place = LatLng & { address: string };

export type VehicleType = "RODA_MOTOR" | "RODA_MOBIL";

export type OrderStatus =
  | "SEARCHING"
  | "ACCEPTED"
  | "PICKING_UP"
  | "ON_TRIP"
  | "AWAITING_PAYMENT"
  | "COMPLETED"
  | "CANCELLED";

export const FARE_MATRIX: Record<
  VehicleType,
  { label: string; baseFare: number; perKm: number; icon: string }
> = {
  RODA_MOTOR: {
    label: "RodaMotor",
    baseFare: 10_000,
    perKm: 2_500,
    icon: "motor",
  },
  RODA_MOBIL: {
    label: "RodaMobil",
    baseFare: 20_000,
    perKm: 4_500,
    icon: "mobil",
  },
};

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Distance is stored/priced at 3 decimals. Both the client estimate and the
 * server validation must round identically or the fare check rejects the order.
 */
export function roundDistanceKm(km: number): number {
  return Number(km.toFixed(3));
}

export function formatIDR(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatKm(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return "0 km";
  return `${distanceKm.toFixed(1)} km`;
}

export function calculateFare(
  distanceKm: number,
  vehicleType: VehicleType,
): number {
  const { baseFare, perKm } = FARE_MATRIX[vehicleType];
  const billable = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  return Math.round(baseFare + perKm * billable);
}

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; tone: "searching" | "active" | "success" | "danger" }
> = {
  SEARCHING: { label: "Mencari Armada", tone: "searching" },
  ACCEPTED: { label: "Driver Diterima", tone: "active" },
  PICKING_UP: { label: "Driver Menuju Lokasi", tone: "active" },
  ON_TRIP: { label: "Perjalanan Berlangsung", tone: "active" },
  AWAITING_PAYMENT: { label: "Menunggu Pembayaran", tone: "active" },
  COMPLETED: { label: "Perjalanan Selesai", tone: "success" },
  CANCELLED: { label: "Pesanan Dibatalkan", tone: "danger" },
};

export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  ACCEPTED: "PICKING_UP",
  PICKING_UP: "ON_TRIP",
  ON_TRIP: "AWAITING_PAYMENT",
};

/** Pusat awal peta: Jakarta sebagai titik tengah Jabodetabek & Jawa Barat. */
export const DEFAULT_CENTER: LatLng = { lat: -6.2, lng: 106.8166 };
/** Zoom awal 11: Jakarta, Depok, Bogor, Tangerang, Bekasi hingga Bandung Raya proporsional. */
export const DEFAULT_ZOOM = 11;

const AVERAGE_SPEED_KMH: Record<VehicleType, number> = {
  RODA_MOTOR: 22,
  RODA_MOBIL: 18,
};

/** Rough minutes-to-arrival used for the pickup ETA badge. */
export function estimateEtaMinutes(
  from: LatLng | null,
  to: LatLng | null,
  vehicleType: VehicleType,
): number | null {
  if (!from || !to) return null;
  const km = haversineDistanceKm(from, to);
  if (km <= 0) return 0;
  return Math.max(1, Math.round((km / AVERAGE_SPEED_KMH[vehicleType]) * 60));
}

export function formatEta(minutes: number | null): string {
  if (minutes === null) return "-";
  if (minutes <= 0) return "Tiba";
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} mnt`;
}

export function isValidCoordinate(point: unknown): point is LatLng {
  if (!point || typeof point !== "object") return false;
  const { lat, lng } = point as Partial<LatLng>;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function reverseGeocodeLabel(
  point: LatLng,
  fallback: string,
): string {
  return `${fallback} (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`;
}

/**
 * Normalisasi plat nomor Indonesia ala Gojek: toleran terhadap input tanpa
 * spasi dan huruf kecil, lalu format ulang menjadi "B 1234 ABC".
 *
 * - "r243567"   -> "R 243567"
 * - "b1234abc"  -> "B 1234 ABC"
 * - "R 2435 ST" -> "R 2435 ST"
 * - "B1234ABC"  -> "B 1234 ABC"
 *
 * Pola: 1-2 huruf depan + 1-6 digit + 0-3 huruf belakang. Digit diperbolehkan
 * sampai 6 agar input seperti "R243567" tidak ditolak.
 */
export function normalizePlateNumber(input: string): string {
  const upper = input.toUpperCase().trim().replace(/\s+/g, " ");
  // Hapus semua karakter selain huruf/angka untuk parsing yang toleran.
  const compact = upper.replace(/[^A-Z0-9]/g, "");
  if (!compact) return upper;

  const match = compact.match(/^([A-Z]{1,2})([0-9]+)([A-Z]{0,3})$/);
  if (match) {
    const [, head, digits, tail] = match;
    return tail ? `${head} ${digits} ${tail}` : `${head} ${digits}`;
  }

  // Fallback: kembalikan versi kapital yang dirapikan.
  return upper;
}

/** Validasi longgar setelah normalisasi: awalan huruf + digit wajib ada. */
export function isValidPlateNumber(input: string): boolean {
  const normalized = normalizePlateNumber(input);
  return /^[A-Z]{1,2}\s[0-9]{1,6}(\s[A-Z]{1,3})?$/.test(normalized);
}
