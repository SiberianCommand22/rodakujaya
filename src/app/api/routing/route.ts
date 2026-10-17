import { NextResponse } from "next/server";
import { quote } from "@/lib/routing";
import { isValidCoordinate, type VehicleType } from "@/lib/utils";

/**
 * Returns the authoritative road distance, duration and fares.
 * The client renders the geometry and displays these fares; POST /api/orders
 * re-derives them from the same cached engine to validate the submitted price.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);

  const num = (key: string) => {
    const raw = url.searchParams.get(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const pickupLat = num("pickupLat");
  const pickupLng = num("pickupLng");
  const dropLat = num("dropLat");
  const dropLng = num("dropLng");

  const pickup = { lat: pickupLat ?? NaN, lng: pickupLng ?? NaN };
  const dropoff = { lat: dropLat ?? NaN, lng: dropLng ?? NaN };

  if (
    !isValidCoordinate(pickup) ||
    !isValidCoordinate(dropoff) ||
    pickupLat === null ||
    pickupLng === null ||
    dropLat === null ||
    dropLng === null
  ) {
    return NextResponse.json(
      {
        error: "VALIDATION_FAILED",
        details: {
          coords: "pickupLat, pickupLng, dropLat, dropLng wajib berupa angka valid",
        },
      },
      { status: 400 },
    );
  }

  const requested = url.searchParams.get("vehicleType");
  const vehicleType =
    requested === "RODA_MOTOR" || requested === "RODA_MOBIL"
      ? (requested as VehicleType)
      : null;

  if (requested !== null && !vehicleType) {
    return NextResponse.json(
      {
        error: "VALIDATION_FAILED",
        details: { vehicleType: "vehicleType harus RODA_MOTOR atau RODA_MOBIL" },
      },
      { status: 400 },
    );
  }

  try {
    const result = await quote(pickup, dropoff);
    return NextResponse.json({
      distanceKm: result.distanceKm,
      durationMinutes: result.durationMinutes,
      geometry: result.geometry,
      source: result.source,
      fare: result.fare,
      selectedVehicleType: vehicleType,
    });
  } catch {
    return NextResponse.json(
      { error: "ROUTING_UNAVAILABLE" },
      { status: 502 },
    );
  }
}