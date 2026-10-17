# Spesifikasi Desain & Arsitektur Sistem - RODAKU

## 1. Identitas Visual & Design System

### 1.1 Palet Warna Utama (Dominan Biru)
- **Primary Action (Royal Blue):** `#1D4ED8` (Tombol pesan, fokus input, garis rute aktif)
- **Primary Dark (Navy Blue):** `#0F172A` (Header/Navbar, typography utama, dark modal)
- **Accent Blue:** `#3B82F6` (Ikon marker driver, badge aktif, link sekunder)
- **Surface / Background:** `#EFF6FF` (Area kartu form, highlight container)
- **Base Canvas:** `#F8FAFC` (Latar belakang layout umum)
- **Status Alert:**
  - Sukses / Selesai: `#16A34A` (Hijau Emerald)
  - Mencari Driver: `#EAB308` (Kuning Amber)
  - Pembatalan: `#DC2626` (Merah Crimson)

### 1.2 Tipografi & Komponen UI
- **Font:** Inter / Sans-serif native Next.js (`font-sans`).
- **Cards & Drawer:** Rounded sudut tegas modern (`rounded-2xl`), shadow lembut (`shadow-xl`), dan border aksen biru halus (`border border-blue-100`).
- **Peta:** Full-bleed background pada perangkat mobile, atau layout 2 kolom (Kiri: panel pemesanan 400px, Kanan: canvas peta interaktif) pada desktop.

## 2. Arsitektur Komponen Frontend

```
src/
├── app/
│   ├── layout.tsx         # Navbar bertema navy (#0F172A) & metadata PWA
│   └── page.tsx           # Layout booking: split view (desktop) / bottom sheet (mobile)
├── components/
│   ├── Map.tsx            # Komponen Leaflet dinamis (SSR: false), marker kustom biru
│   ├── BookingPanel.tsx   # Form input jemput/tujuan, kalkulator jarak, pilih kendaraan
│   └── DriverTracker.tsx  # Komponen penerima sinyal posisi driver via Socket.io
└── lib/
    ├── socket.ts          # Singleton koneksi Socket.io client
    └── utils.ts           # Fungsi hitung jarak Haversine & format mata uang Rupiah
```

## 3. Arsitektur Komunikasi Real-Time (Socket.io)
1. **Event `order:created`:**
   - Dikirim oleh pelanggan setelah menekan tombol "Pesan RODAKU".
   - Server mem-broadcast data order ke namespace armada.
2. **Event `driver:location_update`:**
   - Payload: `{ orderId: string, driverId: string, lat: number, lng: number }`.
   - Server memancarkan koordinat langsung ke room `tracking:{orderId}`.
3. **Event `order:status_update`:**
   - Mengubah tampilan UI pelanggan secara instan (misal dari "Mencari Armada" ke "Driver Menuju Lokasi").

## 4. Skema Data (Prisma ORM)
- **User:** Kredensial akun, peran (CUSTOMER / DRIVER / ADMIN).
- **Driver:** Relasi ke User, status `isOnline`, plat kendaraan, lat/lng terakhir.
- **Order:** ID, koordinat jemput & tujuan, tarif, status pemesanan, relasi Driver dan Customer.
