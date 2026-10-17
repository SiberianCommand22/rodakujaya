"use client";

import { io, type Socket } from "socket.io-client";
import type { OrderStatus, VehicleType } from "./utils";

export type OrderPayload = {
  id: string;
  vehicleType: VehicleType;
  /** Flat lat/lng so both the customer map and the driver console can use it directly. */
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  distanceKm: number;
  fare: number;
  /** Catatan patokan opsional dari pelanggan untuk driver. */
  driverNote?: string | null;
};

export type DriverLocationPayload = {
  orderId: string;
  driverId: string;
  lat: number;
  lng: number;
  heading?: number;
};

export type OrderStatusPayload = {
  orderId: string;
  status: OrderStatus;
  driverId?: string | null;
  plateNumber?: string | null;
  /** Alasan pembatalan pilihan pelanggan, diteruskan ke konsol driver. */
  cancelReason?: string | null;
};

export type PaymentSettledPayload = {
  orderId: string;
  amount?: number;
};

export type ChatRole = "CUSTOMER" | "DRIVER";

/** Wire format for `chat:message` (client → server) and `chat:incoming` (server → room). */
export type ChatMessagePayload = {
  orderId: string;
  senderId: string;
  senderName: string;
  senderRole: ChatRole;
  text: string;
  timestamp: number;
};

export const MAX_CHAT_TEXT = 500;

export const SOCKET_EVENTS = {
  ORDER_CREATED: "order:new",
  TRACK_ORDER: "track:order",
  DRIVER_LOCATION_UPDATE: "driver:location_update",
  ORDER_STATUS_UPDATE: "order:status_update",
  PAYMENT_SETTLED: "payment:settled",
  CHAT_MESSAGE: "chat:message",
  CHAT_INCOMING: "chat:incoming",
} as const;

type ServerToClientEvents = {
  [SOCKET_EVENTS.ORDER_CREATED]: (payload: OrderPayload) => void;
  [SOCKET_EVENTS.ORDER_STATUS_UPDATE]: (payload: OrderStatusPayload) => void;
  [SOCKET_EVENTS.DRIVER_LOCATION_UPDATE]: (payload: DriverLocationPayload) => void;
  [SOCKET_EVENTS.PAYMENT_SETTLED]: (payload: PaymentSettledPayload) => void;
  [SOCKET_EVENTS.CHAT_INCOMING]: (payload: ChatMessagePayload) => void;
};

type ClientToServerEvents = {
  [SOCKET_EVENTS.ORDER_CREATED]: (payload: OrderPayload) => void;
  [SOCKET_EVENTS.TRACK_ORDER]: (orderId: string, ack?: () => void) => void;
  [SOCKET_EVENTS.DRIVER_LOCATION_UPDATE]: (payload: DriverLocationPayload) => void;
  [SOCKET_EVENTS.ORDER_STATUS_UPDATE]: (payload: OrderStatusPayload) => void;
  [SOCKET_EVENTS.PAYMENT_SETTLED]: (payload: PaymentSettledPayload) => void;
  [SOCKET_EVENTS.CHAT_MESSAGE]: (payload: ChatMessagePayload) => void;
};

export type RodakuSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: RodakuSocket | null = null;

export function getSocket(): RodakuSocket {
  if (socket) return socket;

  socket = io(window.location.origin, {
    autoConnect: false,
    transports: ["websocket", "polling"],
    path: "/socket.io",
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
