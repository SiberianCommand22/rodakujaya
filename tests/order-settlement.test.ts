import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  BANK_FIELDS,
  TestClient,
  seedDriver,
  seedOrder,
  startServer,
  stopServer,
} from "./harness";

/**
 * Siklus hulu-hilir: isolasi sesi multi-portal, geocode backend, order
 * SEARCHING → polling driver → ACCEPTED, dan settlement P2P (BANK_TRANSFER)
 * dengan komisi 0% — driver menerima 100% tarif. Berjalan di port terpisah
 * dari features.verify.
 */
describe("RODAKU - E2E order & settlement", { concurrency: false }, () => {
  let db: PrismaClient;

  before(async () => {
    ({ db } = (await import("@/lib/db")) as { db: PrismaClient });
    await startServer();
  });

  after(async () => {
    await stopServer();
    await db.$disconnect();
  });

  async function register(label: string, role: "CUSTOMER" | "DRIVER", extra = {}) {
    const client = new TestClient(label);
    const email = `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@rodaku.test`;
    const suffix = String(Math.floor(Math.random() * 1e6)).padStart(4, "0");
    const res = await client.post<{ user: { id: string; role: string } }>("/api/auth/register", {
      name: `E2E ${label}`,
      email,
      phone: "08123456789",
      password: "verifikasi123",
      role,
      ...BANK_FIELDS,
      accountNumber: `${role === "DRIVER" ? "33" : "44"}${suffix}${suffix.slice(0, 2)}`,
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
      const suffix = String(Math.floor(Math.random() * 1e6)).padStart(4, "0");

      await browser.post("/api/auth/register", {
        name: "Iso Customer",
        email: cEmail,
        phone: "08123456789",
        password: "verifikasi123",
        role: "CUSTOMER",
        ...BANK_FIELDS,
        accountNumber: `55${suffix}${suffix.slice(0, 2)}`,
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
        ...BANK_FIELDS,
        accountNumber: `66${suffix}${suffix.slice(0, 2)}`,
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
      const profile = await browser.request("PATCH", "/api/profile", {
        name: "Iso Customer Updated",
      });
      assert.equal(
        profile.status,
        200,
        `profil customer harus 200: ${JSON.stringify(profile.body)}`,
      );
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
      const profileAfter = await browser.request("PATCH", "/api/profile", {
        name: "Iso Customer After",
      });
      assert.equal(profileAfter.status, 200, "sesi customer harus selamat dari logout driver");
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
      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 40_000,
        status: "ACCEPTED",
      });
      // Kembalikan ke SEARCHING agar masuk daftar available.
      await db.order.update({
        where: { id: trip.id },
        data: { status: "SEARCHING", driverId: null },
      });

      const { client: drvHttp } = await register("e2e-drv2", "DRIVER");
      const avail = await drvHttp.get<{ orders: { id: string }[] }>("/api/driver/orders/available");
      assert.equal(avail.status, 200);
      assert.ok(avail.body.orders.some((o) => o.id === trip.id), "order SEARCHING harus terdaftar");

      // Driver mengambil order dari daftar (klaim ACCEPTED).
      const claim = await drvHttp.request("PATCH", "/api/orders", {
        orderId: trip.id,
        status: "ACCEPTED",
      });
      assert.equal(claim.status, 200, `klaim gagal: ${JSON.stringify(claim.body)}`);

      // Order yang sudah bertuan hilang dari daftar available.
      const availAfter = await drvHttp.get<{ orders: { id: string }[] }>("/api/driver/orders/available");
      assert.ok(
        !availAfter.body.orders.some((o) => o.id === trip.id),
        "order bertuan harus hilang dari daftar",
      );

      // Pelanggan tidak boleh mengintip daftar driver.
      const forbidden = await customer.get("/api/driver/orders/available");
      assert.equal(forbidden.status, 403);
    });
  });

  describe("4. BANK_TRANSFER lunas → 100% ke driver (komisi 0%)", () => {
    it("settlement P2P idempoten dan real-time", async () => {
      const { client: customer, userId } = await register("e2e-pay", "CUSTOMER");
      const { client: driverClient, userId: driverUserId } = await register("e2e-pay-drv", "DRIVER");
      const fare = 50_000;

      const driverUser = await db.user.findUniqueOrThrow({
        where: { id: driverUserId },
        include: { driver: true },
      });
      assert.ok(driverUser.driver, "driver record harus ada");

      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driverUser.driver!.id,
        fare,
        status: "AWAITING_PAYMENT",
      });

      // Customer claims the transfer.
      const claim = await customer.post<{
        payment?: { status: string; amount: number; method: string };
        alreadyClaimed?: boolean;
        error?: string;
      }>(`/api/orders/${trip.id}/pay`, { method: "BANK_TRANSFER" });
      assert.equal(claim.status, 200, `claim gagal: ${JSON.stringify(claim.body)}`);
      assert.equal(claim.body.payment?.status, "CLAIMED");
      assert.equal(claim.body.payment?.method, "BANK_TRANSFER");
      assert.equal(claim.body.payment?.amount, fare);

      // Double-claim is idempotent.
      const replayClaim = await customer.post<{
        alreadyClaimed?: boolean;
      }>(`/api/orders/${trip.id}/pay`, { method: "BANK_TRANSFER" });
      assert.equal(replayClaim.status, 200);
      assert.equal(replayClaim.body.alreadyClaimed, true);

      // Driver confirms receipt → PAID + COMPLETED, driverEarning = fare.
      const confirm = await driverClient.post<{
        payment?: { status: string; amount: number };
        driverEarning?: number;
        error?: string;
      }>(`/api/orders/${trip.id}/confirm-payment`);
      assert.equal(confirm.status, 200, `confirm gagal: ${JSON.stringify(confirm.body)}`);
      assert.equal(confirm.body.payment?.status, "PAID");
      assert.equal(confirm.body.driverEarning, fare, "platform fee 0%");

      const order = await db.order.findUniqueOrThrow({ where: { id: trip.id } });
      assert.equal(order.status, "COMPLETED");

      const payment = await db.payment.findUniqueOrThrow({ where: { orderId: trip.id } });
      assert.equal(payment.status, "PAID");
      assert.equal(Number(payment.amount.toString()), fare);
      assert.equal(payment.bankName, driverUser.bankName);
      assert.equal(payment.accountNumber, driverUser.accountNumber);
      assert.ok(payment.paidAt, "paidAt harus terisi");

      // Replay confirm → 409 (order no longer AWAITING_PAYMENT).
      const replay = await driverClient.post(`/api/orders/${trip.id}/confirm-payment`);
      assert.equal(replay.status, 409);
      assert.equal(replay.body.error, "INVALID_STATE");

      // Double pay after PAID returns alreadyPaid receipt, no state change.
      const payAgain = await customer.post<{ alreadyPaid?: boolean }>(
        `/api/orders/${trip.id}/pay`,
        { method: "BANK_TRANSFER" },
      );
      assert.equal(payAgain.status, 200);
      assert.equal(payAgain.body.alreadyPaid, true);
    });
  });
});
