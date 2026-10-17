/**
 * Kamus lokasi populer Indonesia untuk pencarian instan (<200ms, tanpa
 * jaringan). Hasil kamus selalu didahulukan, lalu digabung dengan hasil
 * Photon/Nominatim dari server.
 */

export type PlaceEntry = {
  label: string;
  address: string;
  lat: number;
  lng: number;
  keywords: string;
};

function p(label: string, address: string, lat: number, lng: number, extra = ""): PlaceEntry {
  return { label, address, lat, lng, keywords: `${label} ${address} ${extra}`.toLowerCase() };
}

export const POPULAR_PLACES_ID: PlaceEntry[] = [
  // ── Jakarta ──
  p("Monas", "Monumen Nasional, Gambir, Jakarta Pusat", -6.1754, 106.8272, "monumen nasional tugu"),
  p("Masjid Istiqlal", "Masjid Istiqlal, Sawah Besar, Jakarta Pusat", -6.1702, 106.8311, "masjid"),
  p("Bundaran HI", "Bundaran Hotel Indonesia, Menteng, Jakarta Pusat", -6.1944, 106.823, "bunderan hotel indonesia selamat datang"),
  p("Stasiun Gambir", "Stasiun Gambir, Gambir, Jakarta Pusat", -6.1765, 106.8309, "stasiun kereta gambir"),
  p("Stasiun Pasar Senen", "Stasiun Pasar Senen, Senen, Jakarta Pusat", -6.1739, 106.845, "stasiun kereta senen"),
  p("Stasiun Manggarai", "Stasiun Manggarai, Tebet, Jakarta Selatan", -6.2089, 106.8525, "stasiun kereta"),
  p("Stasiun Tanah Abang", "Stasiun Tanah Abang, Jakarta Pusat", -6.1865, 106.8108, "stasiun kereta pasar tekstil"),
  p("Grand Indonesia", "Grand Indonesia, Menteng, Jakarta Pusat", -6.195, 106.8204, "mall gi"),
  p("Plaza Indonesia", "Plaza Indonesia, Menteng, Jakarta Pusat", -6.1931, 106.8231, "mall pi"),
  p("Senayan City", "Senayan City, Tanah Abang, Jakarta Pusat", -6.2275, 106.7973, "mall sency"),
  p("Pondok Indah Mall", "Pondok Indah Mall, Kebayoran Lama, Jakarta Selatan", -6.2659, 106.7836, "mall pim"),
  p("Blok M", "Blok M, Kebayoran Baru, Jakarta Selatan", -6.2445, 106.7986, "terminal blok m plaza"),
  p("Kota Tua Jakarta", "Kota Tua, Taman Sari, Jakarta Barat", -6.1352, 106.8133, "batavia museum fatahillah"),
  p("Ancol", "Taman Impian Jaya Ancol, Pademangan, Jakarta Utara", -6.125, 106.83, "dufan pantai ancol"),
  p("TMII", "Taman Mini Indonesia Indah, Cipayung, Jakarta Timur", -6.3025, 106.895, "taman mini"),
  p("Ragunan", "Kebun Binatang Ragunan, Pasar Minggu, Jakarta Selatan", -6.3121, 106.82, "kebun binatang zoo"),
  p("Gelora Bung Karno", "GBK, Tanah Abang, Jakarta Pusat", -6.2186, 106.8028, "stadion gbk senayan"),
  p("RSCM", "RS Cipto Mangunkusumo, Senen, Jakarta Pusat", -6.1975, 106.8475, "rumah sakit rscm"),
  p("RS Fatmawati", "RSUP Fatmawati, Cilandak, Jakarta Selatan", -6.2925, 106.795, "rumah sakit"),
  p("Terminal Kampung Rambutan", "Terminal Kampung Rambutan, Ciracas, Jakarta Timur", -6.3094, 106.8816, "terminal bus"),
  p("Pelabuhan Tanjung Priok", "Pelabuhan Tanjung Priok, Jakarta Utara", -6.1028, 106.8803, "pelabuhan kapal priok"),
  p("Jl Sudirman", "Jl. Jend. Sudirman, Jakarta Selatan", -6.225, 106.805, "jalan sudirman scbd"),
  p("Jl MH Thamrin", "Jl. MH. Thamrin, Jakarta Pusat", -6.19, 106.824, "jalan thamrin"),
  p("Jl Gatot Subroto", "Jl. Gatot Subroto, Jakarta Selatan", -6.235, 106.83, "jalan gatot subroto"),
  p("Bandara Soekarno-Hatta", "Bandara Soekarno-Hatta, Tangerang, Banten", -6.1256, 106.6559, "bandara soetta cengkareng terminal 1 2 3"),
  p("Bandara Halim", "Bandara Halim Perdanakusuma, Jakarta Timur", -6.2667, 106.8917, "bandara halim hlp"),
  // ── Intelijen & Bogor favorit ──
  p("Sekolah Tinggi Intelijen Negara", "STIN, Babakan Madang, Sentul, Bogor", -6.5219, 106.8536, "stin sekolah tinggi intelijen negara sentul bogor"),
  p("Badan Intelijen Negara", "BIN, Pejaten Timur, Pasar Minggu, Jakarta Selatan", -6.2777, 106.8477, "bin badan intelijen negara pejaten jakarta"),
  p("Nasi Telor Keko Bogor", "Nasi Telor Keko, Bogor Tengah, Kota Bogor", -6.5975, 106.7975, "nasi telor keko kuliner bogor"),
  // ── Bogor / Depok / Bekasi / Tangerang ──
  p("Stasiun Bogor", "Stasiun Bogor, Bogor Tengah, Kota Bogor", -6.595, 106.79, "stasiun kereta bogor"),
  p("Kebun Raya Bogor", "Kebun Raya Bogor, Bogor Tengah", -6.5986, 106.7997, "kebun raya krb istana bogor"),
  p("Botani Square", "Botani Square, Bogor Tengah", -6.6019, 106.8067, "mall botani"),
  p("Universitas Indonesia", "Universitas Indonesia, Beji, Depok", -6.3617, 106.8289, "kampus ui"),
  p("Stasiun Depok Baru", "Stasiun Depok Baru, Pancoran Mas, Depok", -6.39, 106.82, "stasiun kereta"),
  p("Stasiun Bekasi", "Stasiun Bekasi, Bekasi Timur", -6.2375, 106.9997, "stasiun kereta bekasi"),
  p("Summarecon Mall Bekasi", "Summarecon Mall Bekasi, Bekasi Utara", -6.2275, 107.0, "mall smb"),
  p("Stasiun Tangerang", "Stasiun Tangerang, Kota Tangerang", -6.1767, 106.6328, "stasiun kereta"),
  p("Supermall Karawaci", "Supermall Karawaci, Tangerang", -6.22, 106.61, "mall karawaci"),
  p("BSD City", "BSD City, Pagedangan, Tangerang Selatan", -6.3, 106.65, "bsd aeon the breeze"),
  p("Alam Sutera", "Alam Sutera, Serpong Utara, Tangerang Selatan", -6.22, 106.65, "mall alam sutera living world"),
  // ── Bandung ──
  p("Stasiun Bandung", "Stasiun Bandung, Cicendo", -6.9147, 107.6025, "stasiun kereta hall bandung"),
  p("Bandara Husein Sastranegara", "Bandara Husein Sastranegara, Cicendo, Bandung", -6.9006, 107.5761, "bandara bdo"),
  p("Gedung Sate", "Gedung Sate, Bandung Wetan", -6.9025, 107.6189, "gedung sate kantor gubernur"),
  p("Trans Studio Bandung", "Trans Studio Bandung, Batununggal", -6.9267, 107.6369, "tsb mall trans"),
  p("Jl Asia Afrika", "Jl. Asia Afrika, Bandung", -6.9217, 107.6075, "jalan alun alun"),
  p("Jl Braga", "Jl. Braga, Sumur Bandung", -6.9175, 107.6097, "jalan braga kuliner"),
  p("ITB", "Institut Teknologi Bandung, Coblong", -6.8915, 107.6107, "kampus itb ganesha"),
  p("Unpad Dipatiukur", "Unpad Kampus Dipatiukur, Coblong, Bandung", -6.8917, 107.6095, "kampus unpad du"),
  p("RS Hasan Sadikin", "RSHS, Pasteur, Bandung", -6.8997, 107.5972, "rumah sakit hasan sadikin"),
  p("Cihampelas Walk", "Cihampelas Walk, Coblong, Bandung", -6.8933, 107.6042, "mall ciwalk"),
  p("Alun-alun Bandung", "Alun-alun Bandung, Regol", -6.9218, 107.6069, "masjid raya bandung"),
  // ── Yogyakarta ──
  p("Stasiun Tugu Yogyakarta", "Stasiun Tugu, Gedongtengen, Yogyakarta", -7.7892, 110.3639, "stasiun kereta tugu lempuyangan"),
  p("Stasiun Lempuyangan", "Stasiun Lempuyangan, Danurejan, Yogyakarta", -7.7917, 110.375, "stasiun kereta lempuyangan"),
  p("Malioboro", "Jl. Malioboro, Yogyakarta", -7.7928, 110.3658, "jalan malioboro shopping"),
  p("Bandara Adisutjipto", "Bandara Adisutjipto, Sleman", -7.7881, 110.4317, "bandara adisucipto jogja"),
  p("Bandara YIA", "Bandara Yogyakarta International Airport, Kulon Progo", -7.9058, 110.0578, "bandara yia kulonprogo"),
  p("UGM", "Universitas Gadjah Mada, Sleman", -7.7714, 110.3781, "kampus ugm"),
  p("UNY", "Universitas Negeri Yogyakarta, Sleman", -7.775, 110.385, "kampus uny"),
  p("RS Sardjito", "RSUP Dr. Sardjito, Sleman", -7.7683, 110.3742, "rumah sakit sardjito"),
  p("Ambarrukmo Plaza", "Ambarrukmo Plaza, Sleman", -7.7825, 110.4019, "mall amplas"),
  p("Hartono Mall", "Hartono Mall Yogyakarta, Sleman", -7.7589, 110.3981, "mall hartono"),
  p("Candi Borobudur", "Candi Borobudur, Magelang", -7.6079, 110.2038, "candi borobudur wisata"),
  p("Candi Prambanan", "Candi Prambanan, Sleman", -7.752, 110.4914, "candi prambanan roro jonggrang"),
  // ── Semarang ──
  p("Stasiun Tawang", "Stasiun Semarang Tawang, Semarang Utara", -6.9644, 110.4283, "stasiun kereta tawang"),
  p("Stasiun Poncol", "Stasiun Semarang Poncol, Semarang Utara", -6.9708, 110.4139, "stasiun kereta poncol"),
  p("Simpang Lima", "Simpang Lima, Semarang Selatan", -6.9903, 110.4229, "simpang lima"),
  p("Undip Tembalang", "Undip Kampus Tembalang, Semarang", -7.05, 110.4381, "kampus undip"),
  p("Unnes Sekaran", "Unnes Kampus Sekaran, Gunungpati, Semarang", -7.0486, 110.4047, "kampus unnes"),
  p("RS Kariadi", "RSUP Dr. Kariadi, Semarang Selatan", -6.9939, 110.4075, "rumah sakit kariadi"),
  p("Paragon Mall", "Paragon City Mall, Semarang Tengah", -6.9825, 110.4097, "mall paragon"),
  p("Bandara Ahmad Yani", "Bandara Ahmad Yani, Semarang Barat", -6.9792, 110.3747, "bandara srg"),
  p("Lawang Sewu", "Lawang Sewu, Semarang Tengah", -6.9839, 110.4108, "lawang sewu wisata tugu muda"),
  // ── Surabaya ──
  p("Stasiun Gubeng", "Stasiun Surabaya Gubeng, Gubeng", -7.2658, 112.7525, "stasiun kereta gubeng"),
  p("Stasiun Pasar Turi", "Stasiun Surabaya Pasar Turi, Bubutan", -7.2456, 112.7347, "stasiun kereta pasarturi"),
  p("Bandara Juanda", "Bandara Juanda, Sidoarjo", -7.3798, 112.7869, "bandara sub sidoarjo"),
  p("Tunjungan Plaza", "Tunjungan Plaza, Genteng, Surabaya", -7.2625, 112.7383, "mall tp"),
  p("Galaxy Mall", "Galaxy Mall, Mulyorejo, Surabaya", -7.275, 112.78, "mall gmall"),
  p("Unair", "Universitas Airlangga, Gubeng, Surabaya", -7.2714, 112.7581, "kampus unair"),
  p("ITS", "Institut Teknologi Sepuluh Nopember, Sukolilo, Surabaya", -7.2825, 112.795, "kampus its"),
  p("RSUD Dr Soetomo", "RSUD Dr. Soetomo, Gubeng, Surabaya", -7.2694, 112.7589, "rumah sakit soetomo"),
  p("Jl Pemuda", "Jl. Pemuda, Surabaya", -7.2597, 112.7419, "jalan pemuda tunjungan"),
  p("Jembatan Suramadu", "Jembatan Suramadu, Kenjeran, Surabaya", -7.18, 112.78, "jembatan suramadu madura"),
  p("Trans Studio Surabaya", "Trans Studio Surabaya (Trans Icon), Siwalankerto", -7.3351, 112.7344, "mall tsm trans icon"),
  // ── Malang / Solo / Purwokerto / Cirebon ──
  p("Stasiun Malang", "Stasiun Malang, Klojen", -7.9772, 112.6372, "stasiun kereta malang kota baru"),
  p("Universitas Brawijaya", "Universitas Brawijaya, Lowokwaru, Malang", -7.9531, 112.6144, "kampus ub"),
  p("Alun-alun Malang", "Alun-alun Tugu Malang, Klojen", -7.9825, 112.6308, "alun alun tugu"),
  p("Jatim Park 2", "Jatim Park 2, Junrejo, Batu", -7.885, 112.5247, "jatim park batu secret zoo museum satwa"),
  p("Stasiun Solo Balapan", "Stasiun Solo Balapan, Banjarsari, Surakarta", -7.5628, 110.8264, "stasiun kereta solo balapan"),
  p("UNS", "Universitas Sebelas Maret, Jebres, Surakarta", -7.5586, 110.8569, "kampus uns"),
  p("Stasiun Purwokerto", "Stasiun Purwokerto, Banyumas", -7.4228, 109.2358, "stasiun kereta purwokerto"),
  p("Unsoed", "Universitas Jenderal Soedirman, Purwokerto", -7.41, 109.24, "kampus unsoed"),
  p("Alun-alun Purwokerto", "Alun-alun Purwokerto, Banyumas", -7.4242, 109.2347, "alun alun"),
  p("Stasiun Cirebon", "Stasiun Cirebon, Kejaksan", -6.7047, 108.5558, "stasiun kereta cirebon kejaksan"),
  // ── Medan / Padang / Palembang ──
  p("Stasiun Medan", "Stasiun Medan, Medan Kota", -3.5928, 98.6808, "stasiun kereta medan"),
  p("Bandara Kualanamu", "Bandara Kualanamu, Deli Serdang", -3.6425, 98.8853, "bandara kno medan"),
  p("USU", "Universitas Sumatera Utara, Padang Bulan, Medan", -3.5617, 98.6564, "kampus usu"),
  p("Sun Plaza", "Sun Plaza, Medan Petisah", -3.5781, 98.6697, "mall sun plaza"),
  p("RS Adam Malik", "RSUP H. Adam Malik, Medan Tuntungan", -3.555, 98.65, "rumah sakit adam malik"),
  p("Bandara Minangkabau", "Bandara Minangkabau, Padang Pariaman", -0.7869, 100.2806, "bandara pdg padang"),
  p("Unand", "Universitas Andalas, Pauh, Padang", -0.915, 100.46, "kampus unand"),
  p("Bandara SMB II", "Bandara Sultan Mahmud Badaruddin II, Palembang", -2.8983, 104.6997, "bandara plm"),
  // ── Indonesia Timur ──
  p("Bandara Sultan Hasanuddin", "Bandara Sultan Hasanuddin, Maros, Sulawesi Selatan", -5.0617, 119.5492, "bandara upg makassar"),
  p("Unhas", "Universitas Hasanuddin, Tamalanrea, Makassar", -5.1328, 119.4881, "kampus unhas"),
  p("Bandara Ngurah Rai", "Bandara Ngurah Rai, Badung, Bali", -8.7472, 115.1672, "bandara dps denpasar bali"),
  p("Unud Jimbaran", "Universitas Udayana Kampus Jimbaran, Badung, Bali", -8.7981, 115.1731, "kampus unud"),
  p("RSUP Sanglah", "RSUP Sanglah, Denpasar, Bali", -8.6714, 115.2139, "rumah sakit sanglah"),
  p("Bandara Sepinggan", "Bandara SAMS Sepinggan, Balikpapan", -1.2683, 116.8986, "bandara bpn balikpapan"),
  p("Bandara Supadio", "Bandara Supadio, Kubu Raya, Kalimantan Barat", -0.1506, 109.4039, "bandara pnk pontianak"),
  p("Bandara Syamsudin Noor", "Bandara Syamsudin Noor, Banjarbaru", -3.4367, 114.7633, "bandara bdj banjarmasin"),
  p("Bandara Sam Ratulangi", "Bandara Sam Ratulangi, Manado", -1.5492, 124.9258, "bandara mno manado"),
];

export type LocalSuggestion = {
  id: string;
  title: string;
  subtitle: string;
  displayName: string;
  lat: number;
  lng: number;
  source: "local";
};

/** Pencarian substring atas kamus, teratas bila cocok di awal label. */
export function searchLocalPlaces(query: string, limit = 6): LocalSuggestion[] {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  const scored: { entry: PlaceEntry; score: number }[] = [];
  for (const entry of POPULAR_PLACES_ID) {
    let score = 0;
    for (const token of tokens) {
      const idx = entry.keywords.indexOf(token);
      if (idx === -1) {
        score = -1;
        break;
      }
      score += idx === 0 || entry.label.toLowerCase().startsWith(token) ? 0 : idx;
    }
    if (score >= 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(({ entry }, i) => ({
    id: `local-${entry.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${i}`,
    title: entry.label,
    subtitle: entry.address,
    displayName: `${entry.label}, ${entry.address}`,
    lat: entry.lat,
    lng: entry.lng,
    source: "local" as const,
  }));
}
