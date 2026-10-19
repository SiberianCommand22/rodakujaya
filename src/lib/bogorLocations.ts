export type BogorLocation = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
};

export const BOGOR_TRAINING_LOCATIONS: BogorLocation[] = [
  {
    id: "muslim-az-zikra",
    label: "Perumahan Muslim Az Zikra",
    address: "Jl. Sabar 1 No. 9, Desa Cipambuan, Kec. Babakan Madang, Kab. Bogor",
    lat: -6.5588,
    lng: 106.8622,
  },
  {
    id: "griya-alam-sentul",
    label: "Griya Alam Sentul",
    address: "Perum. Griya Alam Sentul, Blok B/10 No. 6, Kec. Babakan Madang, Kab. Bogor",
    lat: -6.5385,
    lng: 106.8674,
  },
  {
    id: "parung-aleng-cikeas",
    label: "Parung Aleng Cikeas",
    address: "Jl. Parung Aleng Dekat Sungai, Cikeas, Kec. Babakan Madang, Kab. Bogor",
    lat: -6.5752,
    lng: 106.8771,
  },
  {
    id: "raya-cijayanti",
    label: "Jl. Raya Cijayanti No. 27",
    address: "Cijayanti, Kec. Babakan Madang, Kab. Bogor",
    lat: -6.6021,
    lng: 106.8785,
  },
  {
    id: "taman-tampak-siring",
    label: "Taman Tampak Siring Sentul City",
    address: "Taman Tampak Siring 10 No. 29, Sentul City",
    lat: -6.5861,
    lng: 106.8710,
  },
  {
    id: "ciomas-river-view-2",
    label: "Perumahan Ciomas River View 2",
    address: "Blok G5 No. 7, Seberang Ciomas Harapan, Ciomas Rahayu",
    lat: -6.6125,
    lng: 106.7621,
  },
  {
    id: "stin",
    label: "Sekolah Tinggi Intelijen Negara",
    address: "Kec. Babakan Madang, Kab. Bogor",
    lat: -6.6178,
    lng: 106.8975,
  },
];

export function searchBogorLocations(query: string, limit = 5): BogorLocation[] {
  const q = query.toLowerCase().trim();
  if (!q) return BOGOR_TRAINING_LOCATIONS.slice(0, limit);

  return BOGOR_TRAINING_LOCATIONS.filter(
    (loc) =>
      loc.label.toLowerCase().includes(q) ||
      loc.address.toLowerCase().includes(q) ||
      loc.id.toLowerCase().includes(q)
  ).slice(0, limit);
}

export function getBogorLocationById(id: string): BogorLocation | undefined {
  return BOGOR_TRAINING_LOCATIONS.find((loc) => loc.id === id);
}