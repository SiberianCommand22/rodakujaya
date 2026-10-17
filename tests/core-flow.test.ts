import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { Socket } from "socket.io-client";
import {
  TestClient,
  connectSocket,
  joinTrackingRoom,
  pushTestSchema,
  resetTestDatabase,
  startServer,
  stopServer,
  waitForEvent,
} from "./harness";
import { WELCOME_BALANCE } from "@/lib/walletContract";

type RoutingBody = {
  distanceKm: number;
  durationMinutes: number;
  source: string;
  fare: Record<string, number>;
  geometry: { coordinates: [number, number][] };
};

type OrderBody = {
  order: {
    id: string;
    status: string;
    fare: number;
    promoCode: string | null;
    discount: number;
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    vehicleType: string;
  };
};

type PatchBody = { order: { id: string; status: string } };

type OrderNewPayload = {
  id: string;
  vehicleType: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  distanceKm: number;
  fare: number;
};

type LocationPayload = {
  orderId: string;
  driverId: string;
  lat: number;
  lng: number;
  heading?: number;
};

type PayBody = {
  payment: { id: string; orderId: string; amount: number; status: string };
  alreadyPaid: boolean;
  balance: number | null;
};

type RegisterBody = {
  user: { id: string; role: string; driver?: { id: string } | null };
};

/**
 * Alur penuh pemesanan RODAKU: promo RODAHEMAT → terima driver via socket →
 * 5 titik GPS → ON_TRIP → COMPLETED → RodaPay terpotong harga diskon.
 *
 * Berjalan melawan `tsx server.ts` asli + SQLite terisolasi (port 3199).
 */
describe("RODAKU - alur utama pemesanan", { concurrency: false }, () => {
  let db: PrismaClient;
  const sockets: Socket[] = [];

  async function track(socket: Socket): Promise<Socket> {
    sockets.push(socket);
    return socket;
  }

  function uniqueEmail(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@rodaku.test`;
  }

  before(async () => {
    resetTestDatabase();
    await pushTestSchema();
    process.env.RODAKU_DB_PATH =
      (await import("node:path")).join(process.cwd(), "prisma", "verify.db");
    ({ db } = (await import("@/lib/db")) as { db: PrismaClient });
    await startServer();
  });

  after(async () => {
    for (const socket of sockets) socket.disconnect();
    await stopServer();
    await db.$disconnect();
    resetTestDatabase();
  });

  describe("1-5. Pesan + promo, terima driver, GPS, selesai, bayar", () => {
    it("pelanggan memesan dengan RODAHEMAT, driver menyelesaikan, saldo tepat", async () => {
      const customer = new TestClient("core-customer");
      const driverClient = new TestClient("core-driver");

      // Daftarkan pelanggan & driver (mendapat sesi + dompet + baris driver).
      const custReg = await customer.post<RegisterBody>("/api/auth/register", {
        name: "Pelanggan Inti",
        email: uniqueEmail("core-cust"),
        phone: "08123456789",
        password: "pengujian123",
        role: "CUSTOMER",
      });
      assert.equal(custReg.status, 201);
      const customerId = custReg.body.user.id;

      const drvReg = await driverClient.post<RegisterBody>("/api/auth/register", {
        name: "Driver Inti",
        email: uniqueEmail("core-drv"),
        phone: "08123456780",
        password: "pengujian123",
        role: "DRIVER",
        vehiclePlate: "B 1234 TST",
        vehicleType: "RODA_MOTOR",
        vehicleBrand: "Honda Beat",
      });
      assert.equal(drvReg.status, 201);

      // Tarif acuan dari mesin routing yang sama dengan server.
      const pickup = { lat: -6.2, lng: 106.8 };
      const dropoff = { lat: -6.21, lng: 106.81 };
      const routing = await customer.get<RoutingBody>(
        `/api/routing?pickupLat=${pickup.lat}&pickupLng=${pickup.lng}&dropLat=${dropoff.lat}&dropLng=${dropoff.lng}`,
      );
      assert.equal(routing.status, 200);
      const fullFare = routing.body.fare.RODA_MOTOR;
      assert.ok(fullFare > 0);

      // 1. Pesan dengan promo RODAHEMAT (25%).
      const discount = Math.round((fullFare * 25) / 100);
      const total = fullFare - discount;
      assert.ok(discount > 0 && total > 0);

      const created = await customer.post<OrderBody>("/api/orders", {
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        pickupAddr: "Jl. Jemput Inti",
        dropLat: dropoff.lat,
        dropLng: dropoff.lng,
        dropAddr: "Jl. Tujuan Inti",
        vehicleType: "RODA_MOTOR",
        price: total,
        promoCode: "RODAHEMAT",
        discountAmount: discount,
      });
      assert.equal(created.status, 201, `pesan gagal: ${JSON.stringify(created.body)}`);
      const order = created.body.order;
      assert.equal(order.fare, total);
      assert.equal(order.promoCode, "RODAHEMAT");
      assert.equal(order.discount, discount);

      const stored = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      assert.equal(stored.fare, total);
      assert.equal(stored.promoCode, "RODAHEMAT");
      assert.equal(stored.discount, discount);

      // 2. Driver menerima order via socket order:new → ACCEPTED.
      const driverSocket = await track(await connectSocket());
      const orderNew = waitForEvent<OrderNewPayload>(
        driverSocket,
        "order:new",
        (m) => m.id === order.id,
      );
      const customerSocket = await track(await connectSocket());
      customerSocket.emit("order:new", {
        id: order.id,
        vehicleType: order.vehicleType,
        pickupLat: order.pickupLat,
        pickupLng: order.pickupLng,
        dropoffLat: order.dropoffLat,
        dropoffLng: order.dropoffLng,
        distanceKm: 2.5,
        fare: total,
      });
      const broadcast = await orderNew;
      assert.equal(broadcast.id, order.id);
      assert.equal(broadcast.fare, total);

      const accepted = await driverClient.request<PatchBody>("PATCH", "/api/orders", {
        orderId: order.id,
        status: "ACCEPTED",
      });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.body.order.status, "ACCEPTED");

      // 3. Lima koordinat GPS simulasi diterima utuh di room tracking.
      await Promise.all([
        joinTrackingRoom(customerSocket, order.id),
        joinTrackingRoom(driverSocket, order.id),
      ]);

      const fixes: LocationPayload[] = Array.from({ length: 5 }, (_, i) => ({
        orderId: order.id,
        driverId: "driver-inti",
        lat: pickup.lat + (i + 1) * 0.001,
        lng: pickup.lng + (i + 1) * 0.001,
        heading: 45 + i * 10,
      }));

      for (const fix of fixes) {
        const received = waitForEvent<LocationPayload>(
          customerSocket,
          "driver:location_update",
          (m) => m.lat === fix.lat && m.lng === fix.lng,
        );
        driverSocket.emit("driver:location_update", fix);
        const got = await received;
        assert.equal(got.orderId, order.id);
        assert.equal(got.lat, fix.lat);
        assert.equal(got.lng, fix.lng);
        assert.equal(got.heading, fix.heading);
      }

      // 4. Transisi ON_TRIP → COMPLETED.
      for (const next of ["ON_TRIP", "COMPLETED"] as const) {
        const res = await driverClient.request<PatchBody>("PATCH", "/api/orders", {
          orderId: order.id,
          status: next,
        });
        assert.equal(res.status, 200, `transisi ${next} gagal`);
        assert.equal(res.body.order.status, next);
      }

      // 5. RodaPay terpotong tepat harga diskon.
      const paid = await customer.post<PayBody>(`/api/orders/${order.id}/pay`, {
        method: "RODA_PAY",
      });
      assert.equal(paid.status, 200);
      assert.equal(paid.body.payment.amount, total);
      assert.equal(paid.body.payment.status, "PAID");
      assert.equal(paid.body.balance, WELCOME_BALANCE - total);

      const wallet = await db.wallet.findUniqueOrThrow({ where: { userId: customerId } });
      assert.equal(Number(wallet.balance.toString()), WELCOME_BALANCE - total);
    });
  });
});
