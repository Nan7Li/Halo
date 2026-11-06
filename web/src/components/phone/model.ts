import type { DeviceListItem, VoWiFiCall } from "../../types";

export interface LineCall extends VoWiFiCall {
  deviceId: string;
}

export type CallPhase = "incoming" | "dialing" | "connecting" | "active" | "ended";

export function callPhase(call: VoWiFiCall): CallPhase {
  if (call.state === "ended" || call.state === "failed") return "ended";
  if (call.direction === "incoming" && call.state === "ringing") return "incoming";
  if (call.state === "active") return "active";
  if (call.state === "early_media") return "connecting";
  return "dialing";
}

export function isLive(call: VoWiFiCall) {
  return callPhase(call) !== "ended";
}

/** Whether the browser can place and answer calls on this line. */
export function lineReady(device: DeviceListItem) {
  const transport = device.callAudioTransport;
  if (transport === "cellular" || transport === "vowifi") return !!device.callAudioReady;
  return !!device.vowifiEnabled && !!device.vowifiRuntime?.imsReady;
}

export function lineTransport(device: DeviceListItem): "cellular" | "vowifi" {
  return device.callAudioTransport === "cellular" ? "cellular" : "vowifi";
}

export function sanitizeDial(value: string): string {
  const next = value.replace(/[^\d+*#]/g, "").slice(0, 32);
  if (!next.includes("+")) return next;
  return next[0] === "+" ? `+${next.slice(1).replace(/\+/g, "")}` : next.replace(/\+/g, "");
}

/** Groups digits for display: +86 138 0013 8000, 010 1234 5678, 10086. */
export function formatNumber(value: string): string {
  const raw = value.trim();
  if (!raw || /[^\d+]/.test(raw) || raw.length < 7) return raw;
  if (raw.startsWith("+86") && raw.length === 14) return `+86 ${raw.slice(3, 6)} ${raw.slice(6, 10)} ${raw.slice(10)}`;
  if (raw.startsWith("+1") && raw.length === 12) return `+1 (${raw.slice(2, 5)}) ${raw.slice(5, 8)}-${raw.slice(8)}`;
  if (/^1\d{10}$/.test(raw)) return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`;
  return raw;
}

export function formatElapsed(from?: string | null, now = Date.now()): string {
  if (!from) return "00:00";
  const start = new Date(from).getTime();
  if (!Number.isFinite(start)) return "00:00";
  const total = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours ? `${hours}:${mmss}` : mmss;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** iOS Recents style: time today, "昨天", weekday this week, else date. */
export function formatRecentTime(value?: string | null, now = new Date()): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const time = date.getTime();
  if (time >= startOfToday) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (time >= startOfToday - day) return "昨天";
  if (time >= startOfToday - 6 * day) return date.toLocaleDateString([], { weekday: "long" });
  return date.toLocaleDateString([], { year: "2-digit", month: "numeric", day: "numeric" });
}

export const KEYS: Array<{ value: string; letters?: string; longPress?: string }> = [
  { value: "1", letters: " " },
  { value: "2", letters: "ABC" },
  { value: "3", letters: "DEF" },
  { value: "4", letters: "GHI" },
  { value: "5", letters: "JKL" },
  { value: "6", letters: "MNO" },
  { value: "7", letters: "PQRS" },
  { value: "8", letters: "TUV" },
  { value: "9", letters: "WXYZ" },
  { value: "*" },
  { value: "0", letters: "+", longPress: "+" },
  { value: "#" },
];
