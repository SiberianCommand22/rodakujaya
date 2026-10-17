# PRD (Product Requirements Document) - RODAKU Web

## 1. Ringkasan Produk
RODAKU adalah platform mobilitas on-demand berbasis Progressive Web App (PWA) tanpa ketergantungan instalasi file APK/App Store. Platform ini dirancang responsif untuk browser mobile dan desktop dengan identitas visual bertema dominan Royal Blue (#1D4ED8) dan Navy (#0F172A).

## 2. Tujuan & Masalah yang Diselesaikan
- Menghilangkan friksi unduh dan instalasi aplikasi native untuk pelanggan yang membutuhkan akses transportasi instan.
- Menyediakan platform pemesanan dan pelacakan armada secara real-time langsung melalui URL web.
- Mengurangi jejak memori pada perangkat pengguna dengan arsitektur web yang ringan.

## 3. Persona Pengguna
1. **Pelanggan (Customer):** Mengakses web untuk memasukkan titik jemput, memilih armada (RodaMotor/RodaMobil), mengecek tarif estimasi, dan memantau posisi pengemudi.
2. **Mitra Driver:** Mengakses dasbor web mobile, mengaktifkan status online/offline, menerima pesanan masuk, dan menyiarkan koordinat GPS secara berkala.
3. **Admin:** Memantau transaksi aktif, daftar driver terdaftar, dan status operasional sistem.

## 4. Alur & Fitur Utama (User Journey)
### 4.1 Pemesanan Pelanggan (Booking Engine)
- Deteksi lokasi penjemputan otomatis menggunakan Browser Geolocation API (`navigator.geolocation`).
- Input tujuan dengan pin point interaktif pada peta Leaflet / OpenStreetMap.
- Kalkulasi tarif transparan: Tarif Dasar + (Tarif per Kilometer * Jarak).
- Pilihan armada:
  - **RodaMotor:** Tarif dasar Rp 10.000, Rp 2.500/km berikutnya.
  - **RodaMobil:** Tarif dasar Rp 20.000, Rp 4.500/km berikutnya.

### 4.2 Pencocokan & Telemetri Real-Time (Dispatch & Tracking)
- Pembuatan order memicu broadcast event WebSocket `order:new` ke armada sekitar.
- Pengemudi yang menerima pesanan mengunci status order menjadi `ACCEPTED`.
- Pengemudi menyiarkan koordinat GPS (`driver:location_update`) setiap 3 detik.
- Browser pelanggan merender pergerakan ikon kendaraan secara langsung di atas peta tanpa refresh.

### 4.3 Siklus Hidup Pesanan (Order Lifecycle)
- `SEARCHING` -> `ACCEPTED` -> `PICKING_UP` -> `ON_TRIP` -> `COMPLETED` / `CANCELLED`.

## 5. Kebutuhan Non-Fungsional
- **Performa:** Waktu First Contentful Paint (FCP) di bawah 1.5 detik pada koneksi 4G.
- **Ketersediaan Offline/PWA:** File manifest.json dan Service Worker terpasang agar bisa di-install ke Home Screen.
- **Keamanan:** Sanitasi input koordinat, HTTPS mandatory untuk Geolocation API, proteksi query SQL via Prisma ORM.
