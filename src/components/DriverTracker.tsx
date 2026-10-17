"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  SOCKET_EVENTS,
  getSocket,
  type DriverLocationPayload,
  type OrderStatusPayload,
} from "@/lib/socket";

export type ConnectionState = "idle" | "connecting" | "live" | "offline";

type DriverTrackerProps = {
  orderId: string | null;
  onLocation: (payload: DriverLocationPayload) => void;
  onStatus: (payload: OrderStatusPayload) => void;
  onConnectionChange?: (state: ConnectionState) => void;
};

function subscribeConnection(onStoreChange: () => void) {
  const socket = getSocket();
  socket.on("connect", onStoreChange);
  socket.on("disconnect", onStoreChange);
  socket.on("connect_error", onStoreChange);
  return () => {
    socket.off("connect", onStoreChange);
    socket.off("disconnect", onStoreChange);
    socket.off("connect_error", onStoreChange);
  };
}

function getConnectionSnapshot(): ConnectionState {
  const socket = getSocket();
  if (socket.connected) return "live";
  return socket.active ? "connecting" : "offline";
}

function getServerConnectionSnapshot(): ConnectionState {
  return "idle";
}

/**
 * Owns the Socket.io subscription for a single order. The Next.js dev server
 * does not host a Socket.io endpoint, so the connection degrades to `offline`
 * and the booking flow continues to work.
 */
export default function DriverTracker({
  orderId,
  onLocation,
  onStatus,
  onConnectionChange,
}: DriverTrackerProps) {
  const connection = useSyncExternalStore(
    subscribeConnection,
    getConnectionSnapshot,
    getServerConnectionSnapshot,
  );

  const locationHandler = useRef(onLocation);
  const statusHandler = useRef(onStatus);
  const connectionHandler = useRef(onConnectionChange);

  useEffect(() => {
    locationHandler.current = onLocation;
    statusHandler.current = onStatus;
    connectionHandler.current = onConnectionChange;
  });

  useEffect(() => {
    connectionHandler.current?.(connection);
  }, [connection]);

  useEffect(() => {
    const socket = getSocket();

    if (!socket.connected) socket.connect();

    return () => {
      socket.off("connect", () => undefined);
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();

    if (!orderId) return;

    const handleStatus = (payload: OrderStatusPayload) => {
      if (payload.orderId === orderId) statusHandler.current(payload);
    };
    const handleLocation = (payload: DriverLocationPayload) => {
      if (payload.orderId === orderId) locationHandler.current(payload);
    };

    socket.on(SOCKET_EVENTS.ORDER_STATUS_UPDATE, handleStatus);
    socket.on(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, handleLocation);

    const rejoin = () => socket.emit(SOCKET_EVENTS.TRACK_ORDER, orderId);
    if (socket.connected) rejoin();
    socket.on("connect", rejoin);

    return () => {
      socket.off(SOCKET_EVENTS.ORDER_STATUS_UPDATE, handleStatus);
      socket.off(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, handleLocation);
      socket.off("connect", rejoin);
    };
  }, [orderId]);

  return null;
}

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: "Siap memesan",
  connecting: "Menghubungkan realtime...",
  live: "Realtime Online",
  offline: "Realtime Offline",
};
