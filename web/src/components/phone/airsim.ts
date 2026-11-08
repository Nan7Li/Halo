// The Android phone paired over AirSIM, presented to the phone UI as one
// more line. Its calls are AirSIM's Telecom calls; its audio comes over the
// phone's VoWLAN PCM gateway through /api/airsim/calls/media.
import type { DeviceListItem, VoWiFiCall } from "../../types";

export const AIRSIM_LINE_ID = "airsim";

export interface AirSIMSlot {
  id: string;
  label: string;
  number?: string;
  default?: boolean;
  slotIndex?: number;
  carrierName?: string;
  isEmbedded?: boolean;
}

export interface AirSIMCall {
  id: string;
  androidId?: string;
  direction: "incoming" | "outgoing" | string;
  state: "dialing" | "incoming" | "active" | "held" | "ended" | string;
  number?: string;
  startedAt?: string;
  endedAt?: string;
  missed?: boolean;
}

export interface AirSIMStatus {
  paired: boolean;
  state: "unpaired" | "connecting" | "online" | "offline";
  error?: string;
  host?: string;
  controlPort?: number;
  pcmPort?: number;
  agentId?: string;
  deviceName?: string;
  manufacturer?: string;
  model?: string;
  phoneNumber?: string;
  pairedAt?: string;
  lastSeen?: string;
  battery?: { percent: number; charging: boolean } | null;
  simSlots: AirSIMSlot[];
  call: AirSIMCall | null;
  history: AirSIMCall[];
  revision: number;
}

export function airsimName(status: AirSIMStatus) {
  return status.deviceName || [status.manufacturer, status.model].filter(Boolean).join(" ") || "安卓手机";
}

/** The phone as a line of the call UI, when it is paired. */
export function airsimLine(status: AirSIMStatus): DeviceListItem {
  const online = status.state === "online";
  return {
    id: AIRSIM_LINE_ID,
    name: airsimName(status),
    deviceType: "zxic",
    supportsCellLock: false,
    running: online,
    healthy: online,
    controlOnline: online,
    callAudioTransport: "airsim",
    callAudioReady: online,
    callAudioReason: online ? "" : status.error || "安卓手机离线",
  } as DeviceListItem;
}

/** AirSIM's Telecom states in the shape the call UI already understands. */
export function airsimCall(call: AirSIMCall): VoWiFiCall {
  const state =
    call.state === "incoming" ? "ringing" : call.state === "held" ? "active" : call.state === "dialing" ? "dialing" : call.state;
  return {
    id: call.id,
    number: call.number,
    direction: call.direction === "incoming" ? "incoming" : "outgoing",
    state,
    startedAt: call.startedAt,
    // The PCM gateway only opens for a call that is up.
    mediaReady: state === "active",
    codec: "PCMU",
  };
}
