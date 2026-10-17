import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { Socket } from "socket.io-client";
import {
  BASE_URL,
  TEST_DB,
  TestClient,
  connectSocket,
  expectNoEvent,
  joinTrackingRoom,
  pushTestSchema,
  resetTestDatabase,
  seedDriver,
  seedOrder,
  startServer,
  stopServer,
  waitForEvent,
  type ApiResponse,
  type SeededDriver,
} from "./harness";
import {
  buildReviewPayload,
  canSubmitReview,
  nextQueueIndex,
  queueBadge,
} from "@/lib/tripSettlement";
import { WELCOME_BALANCE, TOPUP_OPTIONS } from "@/lib/walletContract";

type WalletBody = {
  wallet: {
    id: string;
    balance: number;
    transactions: {
      id: string;
      amount: number;
      type: string;
      description: string;
      createdAt: string;
    }[];
  };
};

type OrdersBody = {
  pendingSettlement: { orderId: string; needsReview: boolean } | null;
  pendingSettlements: { orderId: string; fare: number; needsReview: boolean }[];
};

type PayBody = {
  payment: {
    id: string;
    orderId: string;
    method: string;
    amount: number;
    status: string;
  };
  alreadyPaid: boolean;
  balance: number | null;
  error?: string;
  message?: string;
  required?: number;
};

type AuthBody = { user: { id: string; name: string; role: string } };

/**
 * End-to-end verification of the RodaPay wallet, the zero-pollution review flow,
 * the unpaid queue and the real-time chat channel.
 *
 * Runs against a real `tsx server.ts` process and an isolated SQLite file, so
 * every assertion exercises the same code path a browser would.
 */
describe("RODAKU - verifikasi fitur", { concurrency: false }, () => {
  let db: PrismaClient;

  before(async () => {
    resetTestDatabase();
    await pushTestSchema();

    // Must happen before src/lib/db.ts is first imported: the client binds the
    // database file at construction time.
    process.env.RODAKU_DB_PATH = TEST_DB;

    ({ db } = (await import("@/lib/db")) as { db: PrismaClient });

    await startServer();
  });

  after(async () => {
    await stopServer();
    await db.$disconnect();
    resetTestDatabase();
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
    });

    assert.equal(res.status, 201, `registrasi gagal: ${JSON.stringify(res.body)}`);
    return { client, userId: res.body.user.id };
  }

  // ------------------------------------------------------------------
  // Skenario 1 - Wallet otomatis saat pendaftaran
  // ------------------------------------------------------------------
  describe("1. Wallet dibuat otomatis saat pendaftaran", () => {
    it("memberi saldo awal Rp 100.000 dan ledger kosong", async () => {
      const { client, userId } = await registerCustomer("wallet-awal");

      const wallet = await db.wallet.findUnique({ where: { userId } });
      assert.ok(wallet, "wallet harus dibuat bersama user");
      assert.equal(Number(wallet.balance.toString()), WELCOME_BALANCE);

      const res = await client.get<WalletBody>("/api/wallet");
      assert.equal(res.status, 200);
      assert.equal(res.body.wallet.balance, WELCOME_BALANCE);
      assert.deepEqual(res.body.wallet.transactions, []);

      // Driver memakai jalur registrasi yang sama.
      const driver = new TestClient("wallet-driver");
      const driverRes = await driver.post<AuthBody>("/api/auth/register", {
        name: "Driver Dompet",
        email: `verify-driver-wallet-${Date.now()}@rodaku.test`,
        phone: "08123456789",
        password: "verifikasi123",
        role: "DRIVER",
        vehiclePlate: "B 1234 VER",
        vehicleType: "RODA_MOTOR",
        vehicleBrand: "Honda Beat",
      });
      assert.equal(driverRes.status, 201);

      const driverWallet = await db.wallet.findUnique({
        where: { userId: driverRes.body.user.id },
      });
      assert.equal(
        Number(driverWallet?.balance.toString()),
        WELCOME_BALANCE,
        "driver juga mendapat saldo awal",
      );
    });

    it("menolak akses dompet tanpa sesi", async () => {
      const anon = new TestClient("anon");
      const res = await anon.get("/api/wallet");
      assert.equal(res.status, 401);
    });
  });

  // ------------------------------------------------------------------
  // Skenario 2 - RODA_PAY: penolakan saat saldo kurang, potong saat cukup
  // ------------------------------------------------------------------
  describe("2. Pembayaran RODA_PAY", () => {
    it("menolak 400 saat saldo kurang dan memotong saldo saat cukup", async () => {
      const { client, userId } = await registerCustomer("rodapay");
      const driver: SeededDriver = await seedDriver(db, "bayar");

      // Fare 120.000 > saldo awal 100.000.
      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 120_000,
      });

      const rejected = await client.post<PayBody>(`/api/orders/${trip.id}/pay`, {
        method: "RODA_PAY",
      });

      assert.equal(rejected.status, 400);
      assert.equal(rejected.body.error, "INSUFFICIENT_BALANCE");
      assert.equal(rejected.body.message, "Saldo RodaPay tidak mencukupi");
      assert.equal(rejected.body.balance, WELCOME_BALANCE);
      assert.equal(rejected.body.required, 120_000);

      // Penolakan tidak boleh meninggalkan jejak: tidak ada payment, tidak ada
      // mutasi dompet, saldo utuh.
      const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
      assert.equal(await db.payment.count({ where: { orderId: trip.id } }), 0);
      assert.equal(
        await db.walletTransaction.count({ where: { walletId: wallet.id } }),
        0,
      );
      assert.equal(Number(wallet.balance.toString()), WELCOME_BALANCE);

      // Top-up secukupnya, lalu bayar.
      const topup = await client.post<WalletBody>("/api/wallet/topup", {
        amount: 50_000,
      });
      assert.equal(topup.status, 200);
      assert.equal(topup.body.wallet.balance, 150_000);

      const paid = await client.post<PayBody>(`/api/orders/${trip.id}/pay`, {
        method: "RODA_PAY",
      });

      assert.equal(paid.status, 200);
      assert.equal(paid.body.alreadyPaid, false);
      assert.equal(paid.body.balance, 30_000);
      assert.equal(paid.body.payment.status, "PAID");
      assert.equal(paid.body.payment.method, "RODA_PAY");
      assert.equal(paid.body.payment.amount, 120_000);

      const after = await db.wallet.findUniqueOrThrow({
        where: { userId },
        include: { transactions: { orderBy: { createdAt: "asc" } } },
      });
      assert.equal(Number(after.balance.toString()), 30_000);

      const ledger = after.transactions.map((t) => [t.type, Number(t.amount.toString())]);
      assert.deepEqual(ledger, [
        ["TOPUP", 50_000],
        ["PAYMENT", 120_000],
      ]);

      // Membayar ulang tidak menarik saldo kedua kali.
      const replay = await client.post<PayBody>(`/api/orders/${trip.id}/pay`, {
        method: "RODA_PAY",
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.alreadyPaid, true);

      const afterReplay = await db.wallet.findUniqueOrThrow({ where: { userId } });
      assert.equal(Number(afterReplay.balance.toString()), 30_000);
    });

    it("menolak metode pembayaran yang tidak dikenal", async () => {
      const { client, userId } = await registerCustomer("metode");
      const driver = await seedDriver(db, "metode");
      const trip = await seedOrder(db, {
        customerId: userId,
        driverId: driver.driverId,
        fare: 20_000,
      });

      const res = await client.post(`/api/orders/${trip.id}/pay`, { method: "BITCOIN" });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, "VALIDATION_FAILED");
    });
  });

  // ------------------------------------------------------------------
  // Skenario 3 - Top-up akurat
  // ------------------------------------------------------------------
  describe("3. Top-up dompet", () => {
    it("menambah saldo tepat sesuai nominal", async () => {
      const { client, userId } = await registerCustomer("topup");
      let expected = WELCOME_BALANCE;

      for (const amount of TOPUP_OPTIONS) {
        const res = await client.post<WalletBody>("/api/wallet/topup", { amount });
        assert.equal(res.status, 200, `top-up ${amount} gagal`);
        expected += amount;
        assert.equal(
          res.body.wallet.balance,
          expected,
          `saldo harus ${expected} setelah top-up ${amount}`,
        );
      }

      const wallet = await db.wallet.findUniqueOrThrow({
        where: { userId },
        include: { transactions: true },
      });
      assert.equal(Number(wallet.balance.toString()), expected);

      // Endpoint hanya mengembalikan 5 mutasi terakhir; wallet ini punya 3.
      const res = await client.get<WalletBody>("/api/wallet");
      assert.equal(res.body.wallet.transactions.length, TOPUP_OPTIONS.length);
      assert.ok(res.body.wallet.transactions.length <= 5);
      assert.equal(res.body.wallet.transactions[0].type, "TOPUP");
      assert.equal(res.body.wallet.transactions[0].amount, TOPUP_OPTIONS[2]);
      assert.match(res.body.wallet.transactions[0].description, /Top-up RodaPay/);
      assert.deepEqual(
        res.body.wallet.transactions.map((t) => t.amount),
        [...TOPUP_OPTIONS].reverse(),
        "mutasi terbaru harus tampil lebih dulu",
      );

      assert.equal(
        wallet.transactions.length,
        3,
        "harus ada tepat satu mutasi per top-up",
      );
    });

    it("menolak nominal di luar daftar dan tidak mengubah saldo", async () => {
      const { client } = await registerCustomer("topup-invalid");

      for (const amount of [1_234, 0, -50_000, 150_000, "abc", null]) {
        const res = await client.post("/api/wallet/topup", { amount });
        assert.equal(res.status, 400, `nominal ${String(amount)} harus ditolak`);
        assert.equal(res.body.error, "VALIDATION_FAILED");
      }

      const wallet = await client.get<WalletBody>("/api/wallet");
      assert.equal(wallet.body.wallet.balance, WELCOME_BALANCE);
    });
  });

  // ------------------------------------------------------------------
  // Skenario 4 - "Lewati Ulasan" tidak mencemari rating driver
  // ------------------------------------------------------------------
  describe("4. Lewati Ulasan", () => {
    it("tidak membuat record Review dan rating driver tetap utuh", async () => {
      const { client, userId } = await registerCustomer("lewati-ulasan");
      const driver = await seedDriver(db, "lewati");

      // Bangun riwayat ulasan nyata: 4, 5, 5 -> rata-rata 4.67 dari 3 ulasan.
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

      // Perilaku tombol "Lewati Ulasan": bayar, lalu jangan pernah memanggil
      // /review karena tidak ada bintang yang dipilih.
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
      assert.equal(
        afterSkip.ratingAvg,
        baseline.ratingAvg,
        "rating rata-rata tidak boleh berubah",
      );
      assert.equal(
        afterSkip.totalTrips,
        baseline.totalTrips,
        "jumlah ulasan tidak boleh bertambah",
      );

      // Bandingkan dengan alur "Kirim Ulasan & Selesai" pada perjalanan lain:
      // satu ulasan 5 bintang menaikkan rata-rata ke 4.75.
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

      // `null` dikonversi menjadi 0 oleh Number(), jadi tetap ditolak.
      for (const rating of [0, 6, -1, 2.5, "abc", null]) {
        const res = await client.post(`/api/orders/${trip.id}/review`, { rating });
        assert.equal(res.status, 400, `rating ${String(rating)} harus ditolak`);
        assert.equal(res.body.error, "VALIDATION_FAILED");
      }

      assert.equal(await db.review.count({ where: { orderId: trip.id } }), 0);
    });
  });

  // ------------------------------------------------------------------
  // Antrean tagihan tertunggak
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

      // Menuntaskan tagihan pertama langsung memantulkan antrean berikutnya.
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

      // Balasan driver sampai ke pelanggan.
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

      // Klien di room lain tidak boleh hear.
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

      // Pesan yang sah tetap lolos setelah payload buruk.
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

    it("endpoint dompet menolak klien tanpa sesi", async () => {
      const anon = new TestClient("anon-wallet");
      const res: ApiResponse = await anon.post("/api/wallet/topup", { amount: 20_000 });
      assert.equal(res.status, 401);
    });
  });
});