"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { DEFAULT_CENTER } from "@/lib/utils";

export type FleetDriver = {
  id: string;
  name: string;
  plateNumber: string;
  isOnline: boolean;
  onTrip: boolean;
  lastLat: number | null;
  lastLng: number | null;
};

function dotIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.35)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

const standbyIcon = dotIcon("#1D4ED8");
const tripIcon = dotIcon("#EF4444");
const offlineIcon = dotIcon("#94A3B8");

export default function AdminFleetMap({ drivers }: { drivers: FleetDriver[] }) {
  const positioned = drivers.filter(
    (d): d is FleetDriver & { lastLat: number; lastLng: number } =>
      typeof d.lastLat === "number" && typeof d.lastLng === "number",
  );
  return (
    <MapContainer
      center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]}
      zoom={12}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {positioned.map((d) => (
        <Marker
          key={d.id}
          position={[d.lastLat, d.lastLng]}
          icon={!d.isOnline ? offlineIcon : d.onTrip ? tripIcon : standbyIcon}
        >
          <Popup>
            <strong>{d.name}</strong>
            <br />
            {d.plateNumber} • {d.onTrip ? "On-trip" : d.isOnline ? "Stanby" : "Offline"}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
