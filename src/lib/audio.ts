"use client";

/**
 * Ride-hailing style notification tone synthesised with the native Web Audio
 * API. No audio files, so nothing to ship or 404 on.
 */

const LOW_HZ = 800;
const HIGH_HZ = 1000;

let ctx: AudioContext | null = null;
let activeNodes: OscillatorNode[] = [];
let activeTimers: ReturnType<typeof setTimeout>[] = [];

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  if (!ctx) ctx = new Ctor();
  // Browsers start the context suspended until a user gesture.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function beep(frequency: number, startAt: number, duration: number) {
  const audio = getContext();
  if (!audio) return;

  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, startAt);

  // Short attack/release envelope so each beep does not click.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.28, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration - 0.02);

  osc.connect(gain).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);

  activeNodes.push(osc);
}

/**
 * Two-tone alternating pattern, repeated a few times.
 * Returns false when Web Audio is unavailable.
 */
export function playOrderAlert(): boolean {
  const audio = getContext();
  if (!audio) return false;

  stopOrderAlert();

  const now = audio.currentTime;
  const beepLength = 0.16;
  const gap = 0.1;
  const cycles = 6;

  for (let i = 0; i < cycles; i++) {
    const t = now + i * (beepLength + gap);
    beep(i % 2 === 0 ? HIGH_HZ : LOW_HZ, t, beepLength);
  }

  const totalMs = cycles * (beepLength + gap) * 1000;
  activeTimers.push(
    setTimeout(() => {
      activeNodes = [];
      activeTimers = [];
    }, totalMs + 200),
  );

  return true;
}

export function stopOrderAlert() {
  for (const timer of activeTimers) clearTimeout(timer);
  activeTimers = [];

  for (const node of activeNodes) {
    try {
      node.stop();
    } catch {
      /* already stopped */
    }
    try {
      node.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  activeNodes = [];
}

export function isAudioSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    (typeof window.AudioContext !== "undefined" ||
      typeof (window as unknown as { webkitAudioContext?: unknown })
        .webkitAudioContext !== "undefined")
  );
}

/** Must be called from a user gesture so later alerts are allowed to play. */
export async function primeAudio() {
  const audio = getContext();
  if (audio?.state === "suspended") await audio.resume();
}