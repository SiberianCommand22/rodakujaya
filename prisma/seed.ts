/**
 * Seeder akun bawaan RODAKU.
 *
 * Jalankan dengan: npm run seed
 * Menggunakan upsert berdasarkan email, jadi aman dijalankan berulang:
 * password selalu diperbarui ke nilai yang benar tanpa error unik.
 *
 * Hash password memakai hashPassword() dari src/lib/auth.ts (scrypt),
 * algoritma yang sama dipakai POST /api/auth/login untuk verifikasi.
 */
import { Prisma } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";
import { db } from "../src/lib/db";

async function seedUser(params: {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "DRIVER" | "CUSTOMER";
  phone: string;
  walletBalance: number;
}) {
  const user = await db.user.upsert({
    where: { email: params.email },
    update: {
      name: params.name,
      password: hashPassword(params.password),
      role: params.role,
      phone: params.phone,
    },
    create: {
      name: params.name,
      email: params.email,
      password: hashPassword(params.password),
      role: params.role,
      phone: params.phone,
    },
  });

  await db.wallet.upsert({
    where: { userId: user.id },
    update: { balance: new Prisma.Decimal(params.walletBalance) },
    create: {
      userId: user.id,
      balance: new Prisma.Decimal(params.walletBalance),
    },
  });

  return user;
}

async function main() {
  // 1. Administrator.
  await seedUser({
    name: "Super Administrator RODAKU",
    email: "siberiantwotwo@gmail.com",
    password: "siberianniboss1337",
    role: "ADMIN",
    phone: "081200000001",
    walletBalance: 500_000,
  });
  console.log("[seed] admin OK: siberiantwotwo@gmail.com");

  // 2. Mitra driver.
  const driverUser = await seedUser({
    name: "Vision Driver",
    email: "vision1337@gmail.com",
    password: "jayaselaluvision21",
    role: "DRIVER",
    phone: "081200000002",
    walletBalance: 250_000,
  });
  await db.driver.upsert({
    where: { userId: driverUser.id },
    update: {
      plateNumber: "B 1337 RDK",
      vehicleType: "RODA_MOTOR",
      isOnline: true,
      isBlocked: false,
      rating: 5.0,
      ratingAvg: 5.0,
      totalTrips: 10,
    },
    create: {
      userId: driverUser.id,
      plateNumber: "B 1337 RDK",
      vehicleType: "RODA_MOTOR",
      isOnline: true,
      isBlocked: false,
      rating: 5.0,
      ratingAvg: 5.0,
      totalTrips: 10,
    },
  });
  console.log("[seed] driver OK: vision1337@gmail.com (B 1337 RDK)");

  // 3. Pelanggan.
  await seedUser({
    name: "Gendeng Sekali",
    email: "gendengsekali1337@gmail.com",
    password: "gendengkowerika1337",
    role: "CUSTOMER",
    phone: "081200000003",
    walletBalance: 200_000,
  });
  console.log("[seed] customer OK: gendengsekali1337@gmail.com");

  console.log("[seed] selesai: 3 akun bawaan sinkron.");
}

main()
  .catch((error) => {
    console.error("[seed] gagal", error);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
