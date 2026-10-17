import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import { db } from "@/lib/db";
import { type OrderStatus } from "@/lib/utils";

const dev = process.env.NODE_ENV !== "production" && !process.argv.includes("--prod");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const hostname = process.env.HOSTNAME ?? "localhost";

const DRIVERS_ROOM = "drivers";

type TrackingPayload = {
  orderId: string;
  driverId: string;
  lat: number;
  lng: number;
  heading?: number;
};

type StatusPayload = {
  orderId: string;
  status: OrderStatus;
  driverId?: string | null;
  plateNumber?: string | null;
  cancelReason?: string | null;
};

const MAX_CHAT_TEXT = 500;
const MAX_CHAT_NAME = 60;

type ChatPayload = {
  orderId: string;
  senderId: string;
  senderName: string;
  senderRole: "CUSTOMER" | "DRIVER";
  text: string;
  timestamp: number;
};

type ChatSenderRole = ChatPayload["senderRole"];

/**
 * Normalises a client-supplied chat frame.
 *
 * Returns null for anything malformed so a buggy or hostile client cannot inject
 * oversized bodies or spoof the recipient room.
 */
function sanitizeChatMessage(raw: unknown): ChatPayload | null {
  if (!raw || typeof raw !== "object") return null;

  const data = raw as Partial<Record<keyof ChatPayload, unknown>>;

  if (typeof data.orderId !== "string" || data.orderId.length === 0) return null;

  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (text.length === 0 || text.length > MAX_CHAT_TEXT) return null;

  const role: ChatSenderRole | null =
    data.senderRole === "CUSTOMER" || data.senderRole === "DRIVER"
      ? data.senderRole
      : null;
  if (!role) return null;

  const name = typeof data.senderName === "string" ? data.senderName.trim() : "";
  const senderId = typeof data.senderId === "string" ? data.senderId.trim() : "";

  return {
    orderId: data.orderId,
    senderId: senderId.slice(0, 64) || "unknown",
    senderName: name.slice(0, MAX_CHAT_NAME) || "Pengguna",
    senderRole: role,
    text,
    // Server clock wins: a client-supplied timestamp cannot be trusted for
    // ordering, and the room is small enough that one timestamp is fine.
    timestamp: Date.now(),
  };
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error("[server] request handler error", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    });
  });

  const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/socket.io",
  });

  /**
   * Latest driver telemetry kept in memory. The driver app streams real GPS
   * fixes via `driver:location_update`; writing every frame to SQLite would
   * mean thousands of pointless writes per trip, so the DB is only touched
   * when the order status changes or the trip completes.
   */
  const lastKnownPosition = new Map<
    string,
    { driverId: string; lat: number; lng: number; heading?: number; at: number }
  >();

  function persistPosition(driverId: string) {
    const last = lastKnownPosition.get(driverId);
    if (!last) return;

    db.driver
      .update({
        where: { id: driverId },
        data: { lastLat: last.lat, lastLng: last.lng },
      })
      .catch((error) =>
        console.error(`[socket] gagal menyimpan posisi driver ${driverId}`, error),
      );
  }

  async function persistStatus(orderId: string, status: OrderStatus, driverId?: string) {
    try {
      await db.order.update({
        where: { id: orderId },
        data: {
          status,
          // Only overwrite driverId when one is supplied. Clients that merely
          // broadcast a status change do not send it, and nulling it here would
          // silently detach the driver from the order.
          ...(driverId ? { driverId } : {}),
        },
      });

      // Status transitions are the checkpoint: flush the in-memory GPS fix here
      // instead of on every 2s telemetry frame.
      if (driverId) persistPosition(driverId);
    } catch (error) {
      console.error(`[socket] gagal menyimpan status ${orderId} -> ${status}`, error);
    }
  }

  function emitStatus(payload: StatusPayload) {
    io.to(`tracking:${payload.orderId}`).emit("order:status_update", payload);
  }

  io.on("connection", (socket) => {
    console.log(`[socket] koneksi masuk: ${socket.id}`);
    socket.join(DRIVERS_ROOM);

    socket.on("track:order", (orderId: unknown, ack?: unknown) => {
      if (typeof orderId !== "string" || orderId.length === 0) return;
      for (const room of socket.rooms) {
        if (room.startsWith("tracking:")) socket.leave(room);
      }
      socket.join(`tracking:${orderId}`);
      console.log(`[socket] ${socket.id} join room tracking:${orderId}`);
      // Acknowledge the join so a caller can wait for room membership before
      // broadcasting to it; otherwise its message can beat its own join.
      if (typeof ack === "function") (ack as () => void)();
    });

    socket.on("order:new", async (order: unknown) => {
      const row = order as { id?: unknown } | null;
      if (!row || typeof row.id !== "string") return;

      // The client only sends coordinates; re-read the row so drivers receive
      // the canonical addresses and fare persisted by the Route Handler.
      const persisted = await db.order.findUnique({ where: { id: row.id } });
      if (!persisted || persisted.status !== "SEARCHING") return;

      console.log(`[socket] order:new ${row.id} disiarkan ke ${DRIVERS_ROOM}`);
      io.to(DRIVERS_ROOM).emit("order:new", {
        id: persisted.id,
        vehicleType: persisted.vehicleType,
        pickupLat: persisted.pickupLat,
        pickupLng: persisted.pickupLng,
        dropoffLat: persisted.dropoffLat,
        dropoffLng: persisted.dropoffLng,
        pickupAddress: persisted.pickupAddress,
        dropoffAddress: persisted.dropoffAddress,
        distanceKm: persisted.distanceKm,
        fare: persisted.fare,
        driverNote: persisted.driverNote,
      });
    });

    socket.on("driver:location_update", (payload: unknown) => {
      const data = payload as Partial<TrackingPayload> | null;
      if (!data || typeof data.orderId !== "string") return;
      if (typeof data.lat !== "number" || typeof data.lng !== "number") return;
      if (data.lat < -90 || data.lat > 90 || data.lng < -180 || data.lng > 180) {
        return;
      }

      const driverId =
        typeof data.driverId === "string" && data.driverId ? data.driverId : "unknown";

      const clean: TrackingPayload = {
        orderId: data.orderId,
        driverId,
        lat: data.lat,
        lng: data.lng,
        ...(typeof data.heading === "number" && Number.isFinite(data.heading)
          ? { heading: data.heading }
          : {}),
      };

      // In-memory only: SQLite is written on status change / completion.
      lastKnownPosition.set(driverId, {
        driverId,
        lat: clean.lat,
        lng: clean.lng,
        heading: clean.heading,
        at: Date.now(),
      });

      io.to(`tracking:${clean.orderId}`).emit("driver:location_update", clean);
    });

    socket.on("order:status_update", (payload: unknown) => {
      const data = payload as Partial<StatusPayload> | null;
      if (!data || typeof data.orderId !== "string" || typeof data.status !== "string") return;
      void persistStatus(
        data.orderId,
        data.status as OrderStatus,
        typeof data.driverId === "string" ? data.driverId : undefined,
      );
      emitStatus({
        orderId: data.orderId,
        status: data.status as OrderStatus,
        driverId: data.driverId ?? null,
        ...(typeof data.plateNumber === "string" && data.plateNumber.length > 0
          ? { plateNumber: data.plateNumber.slice(0, 20) }
          : {}),
        ...(typeof data.cancelReason === "string" && data.cancelReason.length > 0
          ? { cancelReason: data.cancelReason.slice(0, 200) }
          : {}),
      });
    });

    socket.on("chat:message", (payload: unknown) => {
      const message = sanitizeChatMessage(payload);
      if (!message) return;

      // Fan out to everyone watching this trip: the customer and the driver both
      // sit in `tracking:{orderId}`.
      io.to(`tracking:${message.orderId}`).emit("chat:incoming", message);
      console.log(
        `[chat] ${message.senderName} (${message.senderRole}) -> ${message.orderId}: ${message.text}`,
      );
    });

    // Settlement broadcast: setelah /api/payment/qris/verify atau /webhook
    // mengembalikan 200, pengirim meneruskan event ini agar pelanggan dan
    // driver di room tracking:{orderId} menerima konfirmasi lunas real-time.
    socket.on("payment:settled", (payload: unknown) => {
      const data = payload as { orderId?: unknown; amount?: unknown } | null;
      const orderId = typeof data?.orderId === "string" ? data.orderId : null;
      if (!orderId) return;
      io.to(`tracking:${orderId}`).emit("payment:settled", {
        orderId,
        ...(typeof data?.amount === "number" && Number.isFinite(data.amount)
          ? { amount: data.amount }
          : {}),
      });
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket] koneksi terputus: ${socket.id} (${reason})`);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> RODAKU siap di http://${hostname}:${port}`);
    console.log(`> Mode: ${dev ? "development" : "production"}`);
    console.log("> Socket.io aktif di /socket.io");
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[server] menerima ${signal}, menutup dengan rapi`);
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("[server] gagal start", error);
  process.exit(1);
});
