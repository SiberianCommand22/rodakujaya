import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { Socket } from "socket.io-client";
import {
  BASE_URL,
  BANK_FIELDS,
  TestClient,
  connectSocket,
  expectNoEvent,
  joinTrackingRoom,
  seedDriver,
  seedOrder,
  startServer,
  stopServer,
  waitForEvent,
  type SeededDriver,
} from "./harness";
import {
  buildReviewPayload,
  canSubmitReview,
  nextQueueIndex,
  queueBadge,
} from "@/lib/tripSettlement";

type AuthBody = { user: { id: string; name: string; role: string } };

type ProfileBody = {
  user?: {
    id: string;
    name: string;
    phone: string | null;
    bankName: string | null;
    accountNumber: string | null;
    accountHolderName: string | null;
  };
  error?: string;
  message?: string;
  details?: Record<string, string>;
};

type PayBody = {
  payment?: {
    id: string;
    orderId: string;
    method: string;
    amount: number;
    status: string;
    claimedAt?: string | null;
  };
  alreadyClaimed?: boolean;
  alreadyPaid?: boolean;
  error?: string;
  message?: string;
};

type OrdersBody = {
  pendingSettlement: { orderId: string; needsReview: boolean } | null;
  pendingSettlements: {
    orderId: string;
    fare: number;
    needsReview: boolean;
    awaitingPayment: boolean;
  }[];
};

/**
 * End-to-end verification of the P2P bank-transfer flow, the zero-pollution
 * review queue and the real-time chat channel.
 *
 * Runs against a real `tsx server.ts` process and the shared Postgres database
 * (DATABASE_URL). Each scenario creates uniquely identified users so records
 * never collide across runs.
 */
describe("RODAKU - verifikasi fitur", { concurrency: false }, () => {
  let db: PrismaClient;

  before(async () => {
    ({ db } = (await import("@/lib/db")) as { db: PrismaClient });
    await startServer();
  });

  after(async () => {
    await stopServer();
    await db.$disconnect();
  });

  /** Registers a customer and returns a client holding its session cookie. */
  async function registerCustomer(label: string) {
    const client = new TestClient(label);
    const email = `verify-${label}-${Date.now()}-${Math.floor(
      Math.random() * 1e6,
    )}@rodaku.test`;

    const res = await client.post<AuthBody>("/api/auth/register", {
      name: `Pelanggan ${label}`,
      email,
      phone: "08123456789",
      password: "verifikasi123",
      role: "CUSTOMER",
      ...BANK_FIELDS,
      accountNumber: `111111${String(Math.floor(Math.random() * 1e6)).padStart(4, "0")}`,
    });

    assert.equal(res.status, 201, `registrasi gagal: ${JSON.stringify(res.body)}`);
    return { client, userId: res.body.user.id };
  }

  /** Registers a driver with bank details and returns a session client. */
  async function registerDriver(label: string) {
    const client = new TestClient(label);
    const email = `verify-drv-${label}-${Date.now()}-${Math.floor(
      Math.random() * 1e6,
    )}@rodaku.test`;

    const res = await client.post<AuthBody>("/api/auth/register", {
      name: `Driver ${label}`,
      email,
      phone: "08123456789",
      password: "verifikasi123",
      role: "DRIVER",
      vehiclePlate: "B 1234 VER",
      vehicleType: "RODA_MOTOR",
      vehicleBrand: "Honda Beat",
      ...BANK_FIELDS,
      accountNumber: `222222${String(Math.floor(Math.random() * 1e6)).padStart(4, "0")}`,
    });

    assert.equal(res.status, 201, `registrasi driver gagal: ${JSON.stringify(res.body)}`);
    return { client, userId: res.body.user.id };
  }

  // ------------------------------------------------------------------
  // Skenario 1 - Profil + rekening bank wajib terisi saat daftar
  // ------------------------------------------------------------------
  describe("1. Profil & rekening bank", () => {
    it("menyimpan rekening bank saat registrasi dan menolak akses tanpa sesi", async () => {
      const { client, userId } = await registerCustomer("profil-awal");

      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      assert.ok(user.bankName, "bankName harus tersimpan");
      assert.ok(user.accountNumber, "accountNumber harus tersimpan");
      assert.ok(user.accountHolderName, "accountHolderName harus tersimpan");

      const anon = new TestClient("anon-profile");
      const res = await anon.request("PATCH", "/api/profile", { name: "Hacker" });
      assert.equal(res.status, 401);
    });

    it("memperbarui nomor rekening lewat PATCH /api/profile", async () => {
      const { client, userId } = await registerCustomer("profil-update");
      const newAccount = `998877${String(Math.floor(Math.random() * 1e6)).padStart(4, "0")}`;

      const res = await client.request<ProfileBody>(
        "PATCH",
        "/api/profile",
        {
          bankName: "Mandiri",
          accountNumber: newAccount,
          accountHolderName: "Nama Baru",
        },
      );
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.user?.bankName, "Mandiri");
      assert.equal(res.body.user?.accountNumber, newAccount);
      assert.equal(res.body.user?.accountHolderName, "Nama Baru");

      const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
      assert.equal(stored.bankName, "Mandiri");
      assert.equal(stored.accountNumber, newAccount);
      assert.equal(stored.accountHolderName, "Nama Baru");
    });

    it("menolak nomor rekening / bank yang tidak valid", async () => {
      const { client } = await registerCustomer("profil-invalid");

      const badBank = await client.request<ProfileBody>(
        "PATCH",
        "/api/profile",
        { bankName: "Bank Fiktif" },
      );
      assert.equal(badBank.status, 400);
      assert.equal(badBank.body.error, "VALIDATION_FAILED");
      assert.ok(badBank.body.details?.bankName);

      const badAccount = await client.request<ProfileBody>(
        "PATCH",
        "/api/profile",
        { accountNumber: "abc" },
      );
      assert.equal(badAccount.status, 400);
      assert.ok(badAccount.body.details?.accountNumber);
    });
  });

  // ------------------------------------------------------------------
  // Skenario 2 - Pembayaran P2P: CASH & BANK_TRANSFER
  // ------------------------------------------------------------------
  describe("2. Pembayaran P2P", () => {
    it("CASH menyelesaikan order langsung tanpa klaim transfer", async () => {
      const { client, userId } = await registerCustomer("pay-cash");
      const driver = await seedDriver(db, "cash");

      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 20_000,
        status: "ON_TRIP",
      });

      const res = await client.post<PayBody>(`/api/orders/${trip.id}/pay`, {
        method: "CASH",
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.alreadyPaid, false);
      assert.equal(res.body.payment?.method, "CASH");
      assert.equal(res.body.payment?.status, "PAID");
      assert.equal(res.body.payment?.amount, 0);

      const order = await db.order.findUniqueOrThrow({ where: { id: trip.id } });
      assert.equal(order.status, "COMPLETED");
    });

    it("BANK_TRANSFER: CLAIMED lalu driver konfirmasi → PAID + COMPLETED, fee 0%", async () => {
      const { client: customer, userId } = await registerCustomer("pay-transfer");
      const { client: driverClient } = await registerDriver("pay-transfer");
      const driver = await seedDriver(db, "transfer");

      // Driver seed must share the bank of the registered driver session —
      // instead re-seed order against a driver whose userId matches the session.
      const driverUser = await db.user.findFirstOrThrow({
        where: { email: { contains: "pay-transfer" }, role: "DRIVER" },
        include: { driver: true },
      });
      assert.ok(driverUser.driver, "driver record harus ada");

      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driverUser.driver!.id,
        fare: 50_000,
        status: "AWAITING_PAYMENT",
      });
      void driver;

      const claim = await customer.post<PayBody>(`/api/orders/${trip.id}/pay`, {
        method: "BANK_TRANSFER",
      });
      assert.equal(claim.status, 200, JSON.stringify(claim.body));
      assert.equal(claim.body.payment?.status, "CLAIMED");
      assert.equal(claim.body.payment?.method, "BANK_TRANSFER");
      assert.equal(claim.body.payment?.amount, 50_000);
      assert.equal(claim.body.alreadyClaimed, false);

      // Replay claim is idempotent.
      const replay = await customer.post<PayBody>(`/api/orders/${trip.id}/pay`, {
        method: "BANK_TRANSFER",
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.alreadyClaimed, true);

      const confirmed = await driverClient.post<{
        payment?: { status: string; amount: number };
        driverEarning?: number;
        error?: string;
      }>(`/api/orders/${trip.id}/confirm-payment`);
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      assert.equal(confirmed.body.payment?.status, "PAID");
      assert.equal(confirmed.body.driverEarning, 50_000, "driver keeps 100%");

      const order = await db.order.findUniqueOrThrow({ where: { id: trip.id } });
      assert.equal(order.status, "COMPLETED");

      const payment = await db.payment.findUniqueOrThrow({
        where: { orderId: trip.id },
      });
      assert.equal(payment.status, "PAID");
      assert.ok(payment.paidAt, "paidAt harus terisi");
      assert.equal(Number(payment.amount), 50_000);
      assert.equal(payment.bankName, driverUser.bankName);
      assert.equal(payment.accountNumber, driverUser.accountNumber);
    });

    it("menolak metode pembayaran yang tidak dikenal", async () => {
      const { client, userId } = await registerCustomer("metode");
      const driver = await seedDriver(db, "metode");
      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 20_000,
        status: "AWAITING_PAYMENT",
      });

      const res = await client.post(`/api/orders/${trip.id}/pay`, { method: "BITCOIN" });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "VALIDATION_FAILED");
    });

    it("menolak BANK_TRANSFER sebelum perjalanan selesai", async () => {
      const { client, userId } = await registerCustomer("transfer-awal");
      const driver = await seedDriver(db, "transfer-awal");
      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 15_000,
        status: "SEARCHING",
      });

      const res = await client.post<PayBody>(`/api/orders/${trip.id}/pay`, {
        method: "BANK_TRANSFER",
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "INVALID_STATE");
    });
  });

  // ------------------------------------------------------------------
  // Skenario 3 - Endpoint dompet lama dinonaktifkan (410)
  // ------------------------------------------------------------------
  describe("3. Endpoint wallet / QRIS dinonaktifkan", () => {
    it("wallet, topup, withdraw, dan QRIS mengembalikan 410", async () => {
      const { client } = await registerCustomer("stub");

      const routes: { method: "GET" | "POST"; path: string }[] = [
        { method: "GET", path: "/api/wallet" },
        { method: "POST", path: "/api/wallet/topup" },
        { method: "POST", path: "/api/driver/withdraw" },
        { method: "POST", path: "/api/payment/qris" },
        { method: "POST", path: "/api/payment/qris/verify" },
        { method: "POST", path: "/api/payment/qris/webhook" },
      ];

      for (const { method, path } of routes) {
        const res = await client.request(method, path, { amount: 20_000 });
        assert.ok(
          res.status === 410 || res.status === 404,
          `${path} harus 410/404, dapat ${res.status}`,
        );
      }
    });
  });

  // ------------------------------------------------------------------
  // Skenario 4 - "Lewati Ulasan" tidak mencemari rating driver
  // ------------------------------------------------------------------
  describe("4. Lewati Ulasan", () => {
    it("tidak membuat record Review dan rating driver tetap utuh", async () => {
      const { client, userId } = await registerCustomer("lewati-ulasan");
      const driver = await seedDriver(db, "lewati");

      for (const rating of [4, 5, 5]) {
        const history = await seedOrder(db, {
          customerId: userId,
          driverId: driver.driverId,
          fare: 20_000,
        });
        const res = await client.post(`/api/orders/${history.id}/review`, { rating });
        assert.equal(res.status, 201);
      }

      const baseline = await db.driver.findUniqueOrThrow({
        where: { id: driver.driverId },
      });
      assert.equal(baseline.ratingAvg, 4.67);
      assert.equal(baseline.totalTrips, 3);

      const skipped = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 25_000,
      });
      const payRes = await client.post(`/api/orders/${skipped.id}/pay`, {
        method: "CASH",
      });
      assert.equal(payRes.status, 200);

      assert.equal(
        await db.review.count({ where: { orderId: skipped.id } }),
        0,
        "tidak boleh ada Review saat pelanggan melewati ulasan",
      );

      const afterSkip = await db.driver.findUniqueOrThrow({
        where: { id: driver.driverId },
      });
      assert.equal(afterSkip.ratingAvg, baseline.ratingAvg);
      assert.equal(afterSkip.totalTrips, baseline.totalTrips);

      const rated = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 25_000,
      });
      const reviewRes = await client.post(`/api/orders/${rated.id}/review`, {
        rating: 5,
        comment: "Sopan dan cepat",
      });
      assert.equal(reviewRes.status, 201);

      const afterReview = await db.driver.findUniqueOrThrow({
        where: { id: driver.driverId },
      });
      assert.equal(afterReview.ratingAvg, 4.75);
      assert.equal(afterReview.totalTrips, 4);
    });

    it("aturan klien: payload ulasan null bila tidak ada bintang dipilih", () => {
      assert.equal(buildReviewPayload(null, "Mantap"), null);
      assert.equal(canSubmitReview(null), false);
      assert.deepEqual(buildReviewPayload(4, "  services  oke  "), {
        rating: 4,
        comment: "services  oke",
      });
      assert.deepEqual(buildReviewPayload(5, "   "), { rating: 5 });
    });

    it("server tetap menolak rating di luar 1-5", async () => {
      const { client, userId } = await registerCustomer("rating-invalid");
      const driver = await seedDriver(db, "rating");
      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 15_000,
      });

      for (const rating of [0, 6, -1, 2.5, "abc", null]) {
        const res = await client.post(`/api/orders/${trip.id}/review`, { rating });
        assert.equal(res.status, 400, `rating ${String(rating)} harus ditolak`);
        assert.equal(res.body.error, "VALIDATION_FAILED");
      }

      assert.equal(await db.review.count({ where: { orderId: trip.id } }), 0);
    });
  });

  // ------------------------------------------------------------------
  // Skenario 5 - Antrean tagihan tertunggak
  // ------------------------------------------------------------------
  describe("5. Antrean tagihan tertunggak", () => {
    it("mengembalikan seluruh antrean terurut lama ke baru", async () => {
      const { client, userId } = await registerCustomer("antrean");

      const oldest = await seedOrder(db, {
        customerId: userId,
        driverId: (await seedDriver(db, "antrean-a")).driverId,
        fare: 18_000,
        createdAt: new Date("2026-01-01T08:00:00.000Z"),
      });
      const newest = await seedOrder(db, {
        customerId: userId,
        driverId: (await seedDriver(db, "antrean-b")).driverId,
        fare: 22_000,
        createdAt: new Date("2026-01-01T09:00:00.000Z"),
      });

      const res = await client.get<OrdersBody>("/api/orders?limit=20");
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.body.pendingSettlements.map((p) => p.orderId),
        [oldest.id, newest.id],
      );
      assert.equal(res.body.pendingSettlement?.orderId, oldest.id);
      assert.equal(queueBadge(0, 2)?.text, "Tagihan 1 dari 2");
      assert.equal(queueBadge(0, 1), null);

      await client.post(`/api/orders/${oldest.id}/pay`, { method: "CASH" });

      const afterFirst = await client.get<OrdersBody>("/api/orders?limit=20");
      assert.deepEqual(
        afterFirst.body.pendingSettlements.map((p) => p.orderId),
        [newest.id],
      );

      const queue = afterFirst.body.pendingSettlements;
      assert.equal(nextQueueIndex(queue, oldest.id), null);
      assert.equal(nextQueueIndex(queue, newest.id), null);
      assert.equal(
        nextQueueIndex([{ orderId: "a" }, { orderId: "b" }], "a"),
        1,
      );
    });
  });

  // ------------------------------------------------------------------
  // Skenario 6 - Chat real-time via Socket.io
  // ------------------------------------------------------------------
  describe("6. Chat real-time", () => {
    const sockets: Socket[] = [];

    const track = async (socket: Socket) => {
      sockets.push(socket);
      return socket;
    };

    after(() => {
      for (const socket of sockets) socket.disconnect();
    });

    it("menyiarkan chat:message ke room tracking:{orderId}", async () => {
      const { userId } = await registerCustomer("chat-pelanggan");
      const driver = await seedDriver(db, "chat");
      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 30_000,
        status: "ON_TRIP",
      });

      const customer = await track(await connectSocket());
      const driverSide = await track(await connectSocket());
      const bystander = await track(await connectSocket());

      await Promise.all([
        joinTrackingRoom(customer, trip.id),
        joinTrackingRoom(driverSide, trip.id),
        joinTrackingRoom(bystander, "order-yang-berbeda"),
      ]);

      const incoming = waitForEvent<{
        orderId: string;
        senderId: string;
        senderName: string;
        senderRole: string;
        text: string;
        timestamp: number;
      }>(driverSide, "chat:incoming", (m) => m.orderId === trip.id);

      const outbound = {
        orderId: trip.id,
        senderId: userId,
        senderName: "Pelanggan Chat",
        senderRole: "CUSTOMER",
        text: "Saya sudah di titik jemput",
        timestamp: Date.now(),
      };
      customer.emit("chat:message", outbound);

      const received = await incoming;
      assert.equal(received.orderId, trip.id);
      assert.equal(received.senderId, userId);
      assert.equal(received.senderName, "Pelanggan Chat");
      assert.equal(received.senderRole, "CUSTOMER");
      assert.equal(received.text, outbound.text);
      assert.ok(
        Number.isFinite(received.timestamp) && received.timestamp > 0,
        "timestamp harus diisi server",
      );

      const reply = waitForEvent<{ text: string; senderRole: string }>(
        customer,
        "chat:incoming",
        (m) => m.text === "Tolong ditunggu sebentar",
      );
      driverSide.emit("chat:message", {
        orderId: trip.id,
        senderId: driver.userId,
        senderName: "Driver Chat",
        senderRole: "DRIVER",
        text: "Tolong ditunggu sebentar",
        timestamp: Date.now(),
      });
      assert.equal((await reply).senderRole, "DRIVER");

      await expectNoEvent(bystander, "chat:incoming");
    });

    it("membuang payload chat yang rusak", async () => {
      const { userId } = await registerCustomer("chat-invalid");
      const driver = await seedDriver(db, "chat-invalid");
      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 30_000,
        status: "ACCEPTED",
      });

      const listener = await track(await connectSocket());
      await joinTrackingRoom(listener, trip.id);

      listener.emit("chat:message", {
        orderId: trip.id,
        senderId: userId,
        senderName: "Penyerang",
        senderRole: "ADMIN",
        text: "peran tidak valid",
        timestamp: Date.now(),
      });
      listener.emit("chat:message", {
        orderId: trip.id,
        senderId: userId,
        senderName: "Penyerang",
        senderRole: "CUSTOMER",
        text: "   ",
        timestamp: Date.now(),
      });
      listener.emit("chat:message", {
        orderId: trip.id,
        senderId: userId,
        senderName: "Penyerang",
        senderRole: "CUSTOMER",
        text: "x".repeat(501),
        timestamp: Date.now(),
      });
      listener.emit("chat:message", null);
      listener.emit("chat:message", { text: "tanpa orderId" });

      await expectNoEvent(listener, "chat:incoming");

      const ok = waitForEvent<{ text: string }>(listener, "chat:incoming");
      listener.emit("chat:message", {
        orderId: trip.id,
        senderId: userId,
        senderName: "Pelanggan",
        senderRole: "CUSTOMER",
        text: "halo",
        timestamp: Date.now(),
      });
      assert.equal((await ok).text, "halo");
    });
  });

  // ------------------------------------------------------------------
  // Sanity: server tetap melayani halaman utama
  // ------------------------------------------------------------------
  describe("7. Kesehatan server", () => {
    it("melayani beranda dan halaman driver", async () => {
      for (const route of ["/", "/driver"]) {
        const res = await fetch(`${BASE_URL}${route}`, {
          headers: { "x-forwarded-for": "10.99.88.1" },
        });
        assert.equal(res.status, 200, `${route} harus 200`);
      }
    });
  });
});
