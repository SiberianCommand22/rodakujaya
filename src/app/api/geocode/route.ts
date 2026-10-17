import { NextResponse } from "next/server";
import { searchLocalPlaces } from "@/lib/places";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rateLimit";

const UA = { "User-Agent": "RodakuApp/1.0", Accept: "application/json" };
const UPSTREAM_TIMEOUT_MS = 4500;

export type GeoSuggestion = {
  id: string;
  title: string;
  subtitle: string;
  displayName: string;
  lat: number;
  lng: number;
  source: "local" | "nominatim" | "photon";
};

type NominatimRow = { place_id: number; display_name: string; lat: string; lon: string };
type PhotonRes = {
  features?: {
    geometry: { coordinates: [number, number] };
    properties: { osm_id?: number; name?: string; street?: string; district?: string; city?: string; county?: string; state?: string };
  }[];
};

function splitName(displayName: string): { title: string; subtitle: string } {
  const parts = displayName.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { title: displayName, subtitle: "" };
  return { title: parts[0], subtitle: parts.slice(1, 4).join(", ") };
}

// Cache kecil agar ketikan berulang tidak menghantam upstream.
const cache = new Map<string, { at: number; data: GeoSuggestion[] }>();
const CACHE_TTL_MS = 5 * 60_000;

function cached(key: string): GeoSuggestion[] | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.data;
}

function remember(key: string, data: GeoSuggestion[]) {
  if (cache.size > 300) cache.clear();
  cache.set(key, { at: Date.now(), data });
}

async function fetchUpstream(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: UA });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Bias geografis: Jabodetabek & Jawa Barat (Jakarta sebagai titik tengah).
const JABAR_LAT = -6.2;
const JABAR_LON = 106.8166;
// Viewbox Nominatim: kiri,atas,kanan,bawah melingkupi Jakarta–Bogor–Bandung.
const JABAR_VIEWBOX = "106.0,-5.9,108.3,-7.6";

async function searchPhoton(query: string): Promise<GeoSuggestion[]> {
  const biased = /\bindonesia\b/i.test(query) ? query : `${query}, Indonesia`;
  const data = (await fetchUpstream(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(biased)}&limit=6&lang=en&lat=${JABAR_LAT}&lon=${JABAR_LON}`,
  )) as PhotonRes | null;
  const features = Array.isArray(data?.features) ? data!.features! : [];
  const out: GeoSuggestion[] = [];
  features.forEach((f, i) => {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const pr = f.properties ?? {};
    const title = pr.name || pr.street || "Lokasi tanpa nama";
    const subtitle = [pr.street && pr.street !== title ? pr.street : null, pr.district, pr.city || pr.county, pr.state]
      .filter((v): v is string => Boolean(v))
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
      .slice(0, 3)
      .join(", ");
    out.push({
      id: `photon-${pr.osm_id ?? i}-${lat.toFixed(5)}-${lng.toFixed(5)}`,
      title,
      subtitle,
      displayName: subtitle ? `${title}, ${subtitle}` : title,
      lat,
      lng,
      source: "photon",
    });
  });
  return out;
}

async function searchNominatim(query: string): Promise<GeoSuggestion[]> {
  const data = (await fetchUpstream(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&countrycodes=id&limit=6&addressdetails=1&viewbox=${JABAR_VIEWBOX}`,
  )) as NominatimRow[] | null;
  if (!Array.isArray(data)) return [];
  const out: GeoSuggestion[] = [];
  for (const row of data) {
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const { title, subtitle } = splitName(row.display_name);
    out.push({
      id: `nominatim-${row.place_id}`,
      title,
      subtitle,
      displayName: row.display_name,
      lat,
      lng,
      source: "nominatim",
    });
  }
  return out;
}

/**
 * GET /api/geocode?q=... — proxy pencarian lokasi server-side.
 * Kamus lokal (<1ms) digabung hasil Photon/Nominatim (dengan User-Agent
 * resmi, bebas blokir CORS browser). Cache 5 menit per query.
 *
 * GET /api/geocode?lat=..&lon=.. — reverse geocode server-side.
 */
export async function GET(request: Request) {
  const limit = checkRateLimit(`geocode:ip:${clientIdentifier(request)}`, 60, 60_000);
  if (!limit.allowed) {
    return rateLimitResponse(limit, "Terlalu banyak pencarian lokasi. Coba lagi sebentar lagi.");
  }

  const url = new URL(request.url);
  const latRaw = url.searchParams.get("lat");
  const lonRaw = url.searchParams.get("lon");

  // ── Reverse: koordinat → nama (hanya bila kedua parameter ada) ──
  // Number(null) === 0 sehingga guard lama selalu masuk sini dan pencarian
  // teks ?q=... tidak pernah mencapai cabang forward.
  if (latRaw !== null && lonRaw !== null) {
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json({ error: "VALIDATION_FAILED", details: { coords: "koordinat tidak valid" } }, { status: 400 });
    }
    const data = (await fetchUpstream(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
    )) as { display_name?: string } | null;
    const address = data?.display_name?.trim();
    return NextResponse.json({ address: address && address.length > 0 ? address : null });
  }

  // ── Forward: teks → daftar titik ──
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const key = q.toLowerCase();
  const hit = cached(key);
  if (hit) return NextResponse.json({ suggestions: hit, cached: true });

  const local = searchLocalPlaces(q, 6);
  const merged: GeoSuggestion[] = [...local];

  // Fallback penuh: kamus instan + Photon + Nominatim untuk setiap query ≥2 huruf.
  // Hasil upstream diurutkan berdasarkan kedekatan ke Jabodetabek/Jawa Barat.
  if (q.length >= 2) {
    const [photon, nominatim] = await Promise.all([searchPhoton(q), searchNominatim(q)]);
    const dist2 = (lat: number, lng: number) =>
      (lat - JABAR_LAT) * (lat - JABAR_LAT) + (lng - JABAR_LON) * (lng - JABAR_LON);
    const upstream = [...photon, ...nominatim].sort(
      (a, b) => dist2(a.lat, a.lng) - dist2(b.lat, b.lng),
    );
    const seen = new Set(local.map((s) => `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`));
    for (const s of upstream) {
      const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(s);
      if (merged.length >= 8) break;
    }
  }

  remember(key, merged);
  return NextResponse.json({ suggestions: merged, cached: false });
}
