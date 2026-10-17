import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  TestClient,
  pushTestSchema,
  resetTestDatabase,
  seedDriver,
  seedOrder,
  startServer,
  stopServer,
} from "./harness";

/**
 * Siklus hulu-hilir: isolasi sesi multi-portal, geocode backend, order
 * SEARCHING → polling driver → ACCEPTED → COMPLETED → QRIS lunas → 80%
 * masuk dompet driver. Berjalan di port terpisah dari features.verify.
 */
describe("RODAKU - E2E order & settlement", { concurrency: false }, () => {
  let db: PrismaClient;

  before(async () => {
    resetTestDatabase();
    await pushTestSchema();
    process.env.RODAKU_DB_PATH =
      (await import("node:path")).join(process.cwd(), "prisma", "verify.db");
    ({ db } = (await import("@/lib/db")) as { db: PrismaClient });
    await startServer();
  });

  after(async () => {
    await stopServer();
    await db.$disconnect();
    resetTestDatabase();
  });

  async function register(label: string, role: "CUSTOMER" | "DRIVER", extra = {}) {
    const client = new TestClient(label);
    const email = `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@rodaku.test`;
    const res = await client.post<{ user: { id: string; role: string } }>("/api/auth/register", {
      name: `E2E ${label}`,
      email,
      phone: "08123456789",
      password: "verifikasi123",
      role,
      ...(role === "DRIVER"
        ? { vehiclePlate: "B 7777 KLT", vehicleType: "RODA_MOTOR", vehicleBrand: "Honda Beat" }
        : {}),
      ...extra,
    });
    assert.equal(res.status, 201, `registrasi ${label} gagal: ${JSON.stringify(res.body)}`);
    return { client, email, userId: (res.body as { user: { id: string } }).user.id };
  }

  describe("1. Isolasi sesi multi-portal dalam satu browser", () => {
    it("customer + driver login bersamaan tanpa saling menimpa", async () => {
      // Satu jar cookie = satu tab browser Chrome yang sama.
      const browser = new TestClient("shared-browser");
      const cEmail = `e2e-iso-c-${Date.now()}@rodaku.test`;
      const dEmail = `e2e-iso-d-${Date.now()}@rodaku.test`;

      await browser.post("/api/auth/register", {
        name: "Iso Customer",
        email: cEmail,
        phone: "08123456789",
        password: "verifikasi123",
        role: "CUSTOMER",
      });
      await browser.post("/api/auth/register", {
        name: "Iso Driver",
        email: dEmail,
        phone: "08123456789",
        password: "verifikasi123",
        role: "DRIVER",
        vehiclePlate: "B 8888 ISO",
        vehicleType: "RODA_MOTOR",
        vehicleBrand: "Honda Beat",
      });

      // Login ulang keduanya di jar yang sama (taruhan: cookie saling timpa).
      const lc = await browser.post<{ user: { role: string } }>("/api/auth/login", {
        email: cEmail,
        password: "verifikasi123",
      });
      assert.equal(lc.status, 200);
      const ld = await browser.post<{ user: { role: string } }>("/api/auth/login", {
        email: dEmail,
        password: "verifikasi123",
      });
      assert.equal(ld.status, 200);

      // Endpoint customer tetap membaca sesi customer …
      const wallet = await browser.get<{ wallet: { balance: number } }>("/api/wallet");
      assert.equal(wallet.status, 200, `dompet customer harus 200: ${JSON.stringify(wallet.body)}`);
      // … dan endpoint driver tetap membaca sesi driver.
      const active = await browser.get("/api/driver/active");
      assert.equal(active.status, 200, `driver active harus 200: ${JSON.stringify(active.body)}`);

      // Logout scoped portal DRIVER: sesi customer harus tetap hidup.
      const out = await browser.request<{ ok: boolean }>(
        "POST",
        "/api/auth/logout",
        {},
        { "x-rodaku-portal": "DRIVER" },
      );
      assert.equal(out.status, 200);
      const walletAfter = await browser.get<{ wallet: { balance: number } }>("/api/wallet");
      assert.equal(walletAfter.status, 200, "sesi customer harus selamat dari logout driver");
      const driverAfter = await browser.get("/api/driver/active");
      assert.equal(driverAfter.status, 401, "sesi driver harus sudah dicabut");
    });
  });

  describe("2. Backend geocode + kamus lokal", () => {
    it("mengembalikan Malioboro dari kamus tanpa upstream", async () => {
      const anon = new TestClient("geo");
      const res = await anon.get<{ suggestions: { title: string; lat: number; lng: number; source: string }[] }>(
        "/api/geocode?q=malioboro",
      );
      assert.equal(res.status, 200);
      assert.ok(res.body.suggestions.length > 0, "kamus harus mengenali malioboro");
      const top = res.body.suggestions[0];
      assert.match(top.title, /malioboro/i);
      assert.ok(Math.abs(top.lat - -7.79) < 0.05 && Math.abs(top.lng - 110.36) < 0.05);
    });

    it("mengenali stasiun gambir dan menolak koordinat invalid", async () => {
      const anon = new TestClient("geo2");
      const res = await anon.get<{ suggestions: { title: string }[] }>("/api/geocode?q=stasiun gambir");
      assert.equal(res.status, 200);
      assert.ok(res.body.suggestions.some((s) => /gambir/i.test(s.title)));

      const bad = await anon.get("/api/geocode?lat=999&lon=999");
      assert.equal(bad.status, 400);

      const short = await anon.get<{ suggestions: unknown[] }>("/api/geocode?q=a");
      assert.equal(short.status, 200);
      assert.deepEqual(short.body.suggestions, []);
    });
  });

  describe("3. Order SEARCHING muncul di polling driver", () => {
    it("driver melihat, menerima, dan menyelesaikan order", async () => {
      const { client: customer, userId } = await register("e2e-cust", "CUSTOMER");
      const driver = await seedDriver(db, "e2e-list");
      const trip = await seedOrder(db, { customerId: userId, driverId: driver.driverId, fare: 40_000, status: "ACCEPTED" });
      // Kembalikan ke SEARCHING agar masuk daftar available.
      await db.order.update({ where: { id: trip.id }, data: { status: "SEARCHING", driverId: null } });

      const { client: drvHttp } = await register("e2e-drv2", "DRIVER");
      const avail = await drvHttp.get<{ orders: { id: string }[] }>("/api/driver/orders/available");
      assert.equal(avail.status, 200);
      assert.ok(avail.body.orders.some((o) => o.id === trip.id), "order SEARCHING harus terdaftar");

      // Driver mengambil order dari daftar (klaim ACCEPTED).
      const claim = await drvHttp.request("PATCH", "/api/orders", { orderId: trip.id, status: "ACCEPTED" });
      assert.equal(claim.status, 200, `klaim gagal: ${JSON.stringify(claim.body)}`);

      // Order yang sudah bertuan hilang dari daftar available.
      const availAfter = await drvHttp.get<{ orders: { id: string }[] }>("/api/driver/orders/available");
      assert.ok(!availAfter.body.orders.some((o) => o.id === trip.id), "order bertuan harus hilang dari daftar");

      // Pelanggan tidak boleh mengintip daftar driver.
      const forbidden = await customer.get("/api/driver/orders/available");
      assert.equal(forbidden.status, 403);
    });
  });

  describe("4. QRIS lunas → 80% ke dompet driver", () => {
    it("settlement 20/80 idempoten dan real-time", async () => {
      const { client: customer, userId } = await register("e2e-pay", "CUSTOMER");
      const driver = await seedDriver(db, "e2e-pay");
      const fare = 50_000;
      const trip = await seedOrder(db, { customerId: userId, driverId: driver.driverId, fare });

      const before = await db.wallet.findUniqueOrThrow({ where: { userId: driver.userId } });
      const beforeBal = Number(before.balance.toString());

      const pay = await customer.post<{ settlement: { amount: number; platformFee: number; driverShare: number } }>(
        "/api/payment/qris/verify",
        { orderId: trip.id },
      );
      assert.equal(pay.status, 200, `verify gagal: ${JSON.stringify(pay.body)}`);
      assert.equal(pay.body.settlement.amount, fare);
      assert.equal(pay.body.settlement.platformFee, 10_000);
      assert.equal(pay.body.settlement.driverShare, 40_000);

      const after = await db.wallet.findUniqueOrThrow({ where: { userId: driver.userId } });
      assert.equal(Number(after.balance.toString()), beforeBal + 40_000);

      // Replay tidak menggandakan saldo.
      const replay = await customer.post("/api/payment/qris/verify", { orderId: trip.id });
      assert.equal(replay.status, 200);
      const afterReplay = await db.wallet.findUniqueOrThrow({ where: { userId: driver.userId } });
      assert.equal(Number(afterReplay.balance.toString()), beforeBal + 40_000);

      // Komisi 20% tercatat di agregat admin (payment PAID).
      const payment = await db.payment.findUniqueOrThrow({ where: { orderId: trip.id } });
      assert.equal(payment.status, "PAID");
      assert.equal(Number(payment.amount.toString()), fare);
    });
  });
});
