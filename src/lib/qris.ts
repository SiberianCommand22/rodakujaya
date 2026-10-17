/**
 * Dynamic QRIS Engine — RODAKU INDONESIA.
 *
 * Membangun string QRIS Standar (EMVCo Merchant Presented Mode) per pesanan:
 * merchant name, kota, nominal pas harga akhir order, dan referensi transaksi
 * unik. CRC16-CCITT dihitung sesuai spesifikasi EMVCo sehingga payload valid
 * dan bisa dipindai aplikasi pembayaran apa pun (BCA, GoPay, OVO, Dana,
 * ShopeePay) pada integrasi acquirer sungguhan.
 *
 * Catatan produksi: penerbitan QRIS live membutuhkan MPAN dari acquirer
 * (bank/PJP). Konstanta `QRIS_MPAN` di bawah adalah identitas sandbox
 * RODAKU; ganti dengan MPAN resmi saat onboarding ke acquirer.
 */

/** Nama merchant resmi yang tercetak di payload QRIS. */
export const QRIS_MERCHANT_NAME = "RODAKU INDONESIA";
/** Kota merchant sesuai format EMVCo (maks 15 karakter). */
export const QRIS_MERCHANT_CITY = "JAKARTA";
/** Kode mata uang IDR (ISO 4217 numerik). */
export const QRIS_CURRENCY_IDR = "360";
/** Merchant Category Code: transportasi darat/ride-hailing. */
export const QRIS_MCC_TRANSPORT = "4121";
/** Jendela bayar QRIS: 15 menit, sesuai countdown di modal pembayaran. */
export const QRIS_WINDOW_SECONDS = 15 * 60;
/** Globally Unique Identifier QRIS nasional. */
export const QRIS_GUI = "ID.CO.QRIS.WWW";
/**
 * Merchant PAN sandbox RODAKU. Format 16 digit agar lolos validasi panjang
 * minimum field MPAN pada scanner generik.
 */
export const QRIS_MPAN_SANDBOX = "9360099912345678";

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/**
 * CRC16-CCITT (poly 0x1021, init 0xFFFF) sesuai §EMVCo MPM.
 * Mengembalikan 4 karakter heksadesimal uppercase.
 */
export function crc16ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Referensi transaksi pendek dari order id, mis. `A1B2C3D4`. */
export function shortTxRef(orderId: string): string {
  const alnum = orderId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return (alnum.slice(-8) || "RODAKU").padStart(8, "0");
}

export type QrisPayloadInput = {
  orderId: string;
  /** Nominal pas harga akhir order dalam rupiah (bilangan bulat). */
  amount: number;
};

/**
 * Merakit string QRIS dinamis untuk satu pesanan.
 * Deterministik: order + nominal yang sama selalu menghasilkan string sama,
 * sehingga endpoint status bisa membangun ulang tanpa menyimpan blob QR.
 */
export function buildQrisString({ orderId, amount }: QrisPayloadInput): string {
  const rounded = Math.max(0, Math.round(amount));
  const txRef = shortTxRef(orderId);

  const merchantAccount =
    tlv("00", QRIS_GUI) +
    tlv("01", QRIS_MPAN_SANDBOX) +
    tlv("02", "UMI");

  const additionalData = tlv("01", txRef) + tlv("07", `RODAKU-${txRef}`);

  const withoutCrc =
    tlv("00", "01") + // Payload Format Indicator
    tlv("01", "12") + // Point of Initiation: dinamis (nominal terkunci)
    tlv("26", merchantAccount) +
    tlv("52", QRIS_MCC_TRANSPORT) +
    tlv("53", QRIS_CURRENCY_IDR) +
    tlv("54", String(rounded)) +
    tlv("58", "ID") +
    tlv("59", QRIS_MERCHANT_NAME) +
    tlv("60", QRIS_MERCHANT_CITY) +
    tlv("62", additionalData) +
    "6304";

  return withoutCrc + crc16ccitt(withoutCrc);
}

/** Validasi cepat integritas payload (format + CRC). */
export function verifyQrisCrc(payload: string): boolean {
  if (payload.length < 8 || !payload.endsWith(payload.slice(-4))) return false;
  const body = payload.slice(0, -4);
  return crc16ccitt(body) === payload.slice(-4);
}

/** Sisa detik menuju kedaluwarsa dari timestamp ISO. */
export function qrisSecondsLeft(expiresAt: string | Date): number {
  const target = new Date(expiresAt).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, Math.floor((target - Date.now()) / 1000));
}

/** Format detik menjadi `MM:SS` untuk countdown modal. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
