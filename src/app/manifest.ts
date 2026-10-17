import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RODAKU - Transportasi On-Demand",
    short_name: "RODAKU",
    description:
      "Platform mobilitas on-demand RODAKU. Pesan armada dan pantau driver secara real-time langsung dari browser.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F8FAFC",
    theme_color: "#0F172A",
    lang: "id",
    categories: ["travel", "navigation", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Pesan Sekarang", url: "/" },
      { name: "Lacak Driver", url: "/#tracking" },
    ],
  };
}
