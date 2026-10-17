import { calculateFare, haversineDistanceKm, type LatLng, type VehicleType } from "./utils";

/**
 * Single source of truth for road distance, duration and fares.
 *
 * Used by both `GET /api/routing` (for the price the customer sees) and
 * `POST /api/orders` (for validating that price), so the two can never disagree.
 * Running entirely server-side also means OSRM is queried once per route and the
 * client cannot influence pricing.
 */

export const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

/** Road distance is typically ~30% longer than the straight line. */
export const ROAD_DEVIATION = 1.3;
const FALLBACK_SPEED_KMH = 20;
const OSRM_TIMEOUT_MS = 6000;

export type LineString = {
  type: "LineString";
  /** GeoJSON order: [lng, lat]. */
  coordinates: [number, number][];
};

export type RouteResult = {
  distanceKm: number;
  durationMinutes: number;
  geometry: LineString;
  source: "OSRM" | "FALLBACK";
};

export type Quote = RouteResult & {
  fare: Record<VehicleType, number>;
};

const VEHICLES: VehicleType[] = ["RODA_MOTOR", "RODA_MOBIL"];

// Coords are rounded before lookup so nearby requests share one OSRM call,
// which keeps us inside the public demo server's usage policy.
const PRECISION = 3;
const CACHE_MAX = 250;

const cache = new Map<string, RouteResult>();

function key(pickup: LatLng, dropoff: LatLng): string {
  const r = (n: number) => n.toFixed(PRECISION);
  return `${r(pickup.lat)},${r(pickup.lng)};${r(dropoff.lat)},${r(dropoff.lng)}`;
}

function readCache(k: string): RouteResult | undefined {
  const hit = cache.get(k);
  if (!hit) return undefined;
  // Refresh recency for the LRU.
  cache.delete(k);
  cache.set(k, hit);
  return hit;
}

function writeCache(k: string, value: RouteResult) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(k, value);
}

/** Straight line inflated by an average road-deviation factor. */
export function fallbackRoute(pickup: LatLng, dropoff: LatLng): RouteResult {
  const straight = haversineDistanceKm(pickup, dropoff);
  const distanceKm = round3(straight * ROAD_DEVIATION);

  return {
    distanceKm,
    durationMinutes: Math.max(1, Math.round((distanceKm / FALLBACK_SPEED_KMH) * 60)),
    geometry: {
      type: "LineString",
      coordinates: [
        [pickup.lng, pickup.lat],
        [dropoff.lng, dropoff.lat],
      ],
    },
    source: "FALLBACK",
  };
}

function round3(n: number): number {
  return Number(n.toFixed(3));
}

export async function getRoute(
  pickup: LatLng,
  dropoff: LatLng,
): Promise<RouteResult> {
  const k = key(pickup, dropoff);
  const cached = readCache(k);
  if (cached) return cached;

  const url =
    `${OSRM_BASE}/${pickup.lng.toFixed(6)},${pickup.lat.toFixed(6)};` +
    `${dropoff.lng.toFixed(6)},${dropoff.lat.toFixed(6)}` +
    `?overview=full&geometries=geojson`;

  let result: RouteResult;
  try {
    result = await fetchWithTimeout(url, OSRM_TIMEOUT_MS);
  } catch {
    result = fallbackRoute(pickup, dropoff);
  }

  writeCache(k, result);
  return result;
}

async function fetchWithTimeout(url: string, ms: number): Promise<RouteResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);

    const data = (await res.json()) as {
      code?: string;
      routes?: {
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
      }[];
    };

    if (data.code !== "Ok" || !data.routes?.[0]) {
      throw new Error(`OSRM code ${data.code}`);
    }

    const coordinates = data.routes[0].geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      throw new Error("route too short");
    }

    return {
      distanceKm: round3(data.routes[0].distance / 1000),
      durationMinutes: Math.max(1, Math.round(data.routes[0].duration / 60)),
      geometry: { type: "LineString", coordinates },
      source: "OSRM",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Prices a route for every vehicle type from the authoritative road distance. */
export function buildQuote(route: RouteResult): Quote {
  const fare = {} as Record<VehicleType, number>;
  for (const vehicle of VEHICLES) {
    fare[vehicle] = calculateFare(route.distanceKm, vehicle);
  }
  return { ...route, fare };
}

export async function quote(pickup: LatLng, dropoff: LatLng): Promise<Quote> {
  return buildQuote(await getRoute(pickup, dropoff));
}

/** Used by POST /api/orders so the accepted price must match the engine. */
export function fareForRoute(
  route: RouteResult,
  vehicleType: VehicleType,
): number {
  return calculateFare(route.distanceKm, vehicleType);
}

export function clearRouteCache() {
  cache.clear();
}

export function routeCacheSize() {
  return cache.size;
}