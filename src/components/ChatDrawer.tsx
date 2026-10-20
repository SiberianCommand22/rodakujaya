"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatIcon } from "@/components/icons";
import {
  MAX_CHAT_TEXT,
  SOCKET_EVENTS,
  getSocket,
  type ChatMessagePayload,
  type ChatRole,
} from "@/lib/socket";
import type { OrderStatus } from "@/lib/utils";

/** Chat is only meaningful while a trip is still in progress. */
const CHAT_STATUSES: OrderStatus[] = ["ACCEPTED", "PICKING_UP", "ON_TRIP"];

const QUICK_CUSTOMER = [
  "Saya sudah di titik",
  "Tunggu 2 menit ya",
  "Pakai baju hitam",
] as const;

const QUICK_DRIVER = [
  "Sedang menuju ke sana",
  "Sudah sampai ya kak",
  "Macet sedikit",
] as const;

type Props = {
  orderId: string | null;
  status: OrderStatus | null;
  /** Stable identity of the local user; decides bubble alignment. */
  selfId: string | null;
  selfName: string;
  selfRole: ChatRole;
  peerName?: string | null;
  /** Increment untuk membuka drawer dari tombol "Chat Driver" di kartu pesanan. */
  openSignal?: number;
  /** Meneruskan jumlah pesan belum dibaca ke badge di kartu pesanan. */
  onUnreadChange?: (count: number) => void;
};

export default function ChatDrawer({
  orderId,
  status,
  selfId,
  selfName,
  selfRole,
  peerName,
  openSignal = 0,
  onUnreadChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessagePayload[]>([]);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);
  const selfIdRef = useRef(selfId);
  const unreadRef = useRef(onUnreadChange);
  useEffect(() => {
    unreadRef.current = onUnreadChange;
  }, [onUnreadChange]);

  // Sinyal eksternal dari tombol "💬 Chat Driver": buka drawer di atas semua elemen.
  const lastSignal = useRef(openSignal);
  useEffect(() => {
    if (openSignal === lastSignal.current) return;
    lastSignal.current = openSignal;
    if (openSignal <= 0) return;
    const t = setTimeout(() => {
      unreadRef.current?.(0);
      setUnread(0);
      setOpen(true);
    }, 0);
    return () => clearTimeout(t);
  }, [openSignal]);

  useEffect(() => {
    selfIdRef.current = selfId;
  }, [selfId]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const visible = orderId !== null && status !== null && CHAT_STATUSES.includes(status);

  useEffect(() => {
    if (!orderId) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const onIncoming = (message: ChatMessagePayload) => {
      if (message.orderId !== orderId) return;

      setMessages((prev) => {
        // The server echoes to the whole room, including the sender.
        if (message.senderId === selfIdRef.current) return prev;
        return [...prev, message];
      });

      if (!openRef.current) {
        setUnread((n) => {
          const next = n + 1;
          unreadRef.current?.(next);
          return next;
        });
      }
    };

    const join = () => socket.emit(SOCKET_EVENTS.TRACK_ORDER, orderId);
    if (socket.connected) join();
    socket.on("connect", join);
    socket.on(SOCKET_EVENTS.CHAT_INCOMING, onIncoming);

    return () => {
      socket.off("connect", join);
      socket.off(SOCKET_EVENTS.CHAT_INCOMING, onIncoming);
    };
  }, [orderId]);

  // Keep the newest bubble in view.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open]);

  const send = useCallback(
    async (text: string) => {
      const body = text.trim().slice(0, MAX_CHAT_TEXT);
      if (!orderId || body.length === 0) return;

      const payload: ChatMessagePayload = {
        orderId,
        senderId: selfIdRef.current ?? "unknown",
        senderName: selfName,
        senderRole: selfRole,
        text: body,
        timestamp: Date.now(),
      };

      const socket = getSocket();
      if (!socket.connected) socket.connect();

      // Wait for the room join to be acknowledged: a message broadcast before
      // the server has processed our own join would not reach the other party.
      try {
        await socket.emitWithAck(SOCKET_EVENTS.TRACK_ORDER, orderId);
      } catch {
        // Join failed; the reconnect handler retries.
      }

      setMessages((prev) => [...prev, payload]);
      socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, payload);
    },
    [orderId, selfName, selfRole],
  );

  const toggle = useCallback(() => {
    setUnread(0);
    unreadRef.current?.(0);
    setOpen((v) => !v);
  }, []);

  if (!visible || !orderId) return null;

  const counterpart =
    selfRole === "DRIVER" ? "Pelanggan" : (peerName ?? "Driver");

  const quickReplies = selfRole === "DRIVER" ? QUICK_DRIVER : QUICK_CUSTOMER;

  return (
    <>
      <button
        type="button"
        aria-label={`Chat dengan ${counterpart}`}
        onClick={toggle}
        className="fixed bottom-24 right-4 z-[3000] flex h-14 w-14 items-center justify-center rounded-full bg-[#1D4ED8] text-white shadow-2xl transition hover:bg-[#1E40AF] lg:bottom-6"
      >
        <ChatIcon className="h-6 w-6" />
        {unread > 0 && !open && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[3000] flex justify-end">
          <button
            type="button"
            aria-label="Tutup chat"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[#0F172A]/50 backdrop-blur-sm"
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Chat dengan ${counterpart}`}
            className="relative flex h-full w-full max-w-sm flex-col bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-blue-100 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-[#0F172A]">
                  Chat {selfRole === "DRIVER" ? "Pelanggan" : "Driver"}
                </h2>
                <p className="truncate text-xs text-slate-500">{counterpart}</p>
              </div>
              <button
                type="button"
onClick={() => setOpen(false)}
 className="rounded-xl bg-[#EFF6FF] px-3 py-1.5 text-sm font-semibold text-[#1D4ED8]"
              >
                Tutup
              </button>
            </header>

            <div
              ref={listRef}
              className="flex-1 space-y-2 overflow-y-auto bg-[#F8FAFC] px-4 py-4"
            >
              {messages.length === 0 && (
                <p className="py-10 text-center text-xs text-slate-400">
                  Belum ada pesan. Sapa {counterpart} bila perlu.
                </p>
              )}

              {messages.map((m) => {
                const mine = m.senderId === (selfId ?? "unknown");
                return (
                  <div
                    key={`${m.timestamp}-${m.senderId}`}
                    className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div className="max-w-[80%]">
                      {!mine && (
                        <p className="mb-0.5 px-1 text-[10px] font-medium text-slate-400">
                          {m.senderName}
                        </p>
                      )}
                      <p
                        className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${
                          mine
                            ? "rounded-br-sm bg-[#1D4ED8] text-white"
                            : "rounded-bl-sm border border-blue-100 bg-white text-[#0F172A]"
                        }`}
                      >
                        {m.text}
                      </p>
                      <p
                        className={`mt-0.5 px-1 text-[9px] text-slate-400 ${
                          mine ? "text-right" : "text-left"
                        }`}
                      >
                        {new Date(m.timestamp).toLocaleTimeString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-blue-100 px-4 py-3">
              <div className="mb-2 flex flex-wrap gap-2">
                {quickReplies.map((reply) => (
                  <button
                    key={reply}
                    type="button"
                    onClick={() => send(reply)}
                    className="rounded-full border border-blue-100 bg-[#EFF6FF] px-3 py-1.5 text-[11px] font-medium text-[#1D4ED8] transition hover:bg-blue-100"
                  >
                    {reply}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  send(draft);
                  setDraft("");
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={draft}
                  onChange={(e) =>
                    setDraft(e.target.value.slice(0, MAX_CHAT_TEXT))
                  }
                  placeholder="Tulis pesan..."
                  aria-label="Tulis pesan"
                  className="flex-1 rounded-2xl border border-blue-100 px-3 py-2 text-sm outline-none focus:border-[#1D4ED8] focus:ring-2 focus:ring-[#1D4ED8]/20"
                />
                <button
                  type="submit"
                  disabled={draft.trim().length === 0}
                  aria-label="Kirim pesan"
                  className="rounded-2xl bg-[#1D4ED8] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#1E40AF] disabled:opacity-50"
                >
                  Kirim
                </button>
              </form>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}