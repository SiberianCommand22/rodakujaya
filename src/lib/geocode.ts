/**
 * Geocoding balik via proxy backend (/api/geocode) — bebas blokir CORS dan
 * limit browser. Fallback langsung ke Nominatim bila backend tak merespons.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/geocode?lat=${lat}&lon=${lng}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { address?: string | null };
      const address = data.address?.trim();
      if (address && address.length > 0) return address;
    }
  } catch {
    /* lanjut ke fallback langsung */
  }
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    const address = data.display_name?.trim();
    return address && address.length > 0 ? address : null;
  } catch {
    return null;
  }
}
