import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api, apiMessage } from "../../api";
import type { DeviceListItem, DevicesResponse, VoWiFiCall } from "../../types";
import { message } from "../ui/message";
import { useI18n } from "../../lib/i18n";
import { startCallAudio, type AudioStatus, type CallAudioHandle, type MicStatus } from "./callAudio";
import { callPhase, isLive, lineReady, type LineCall } from "./model";
import { AIRSIM_LINE_ID, airsimCall, airsimLine, type AirSIMStatus } from "./airsim";
import { CallOverlay } from "./CallOverlay";

interface CallsResponse {
  deviceId: string;
  transport: string;
  calls: VoWiFiCall[];
}

export interface CallState {
  /** Configured devices (all of them; use lineReady to filter). */
  lines: DeviceListItem[];
  linesLoaded: boolean;
  refreshLines: () => Promise<void>;
  /** The call the UI is focused on: ringing, dialing or in progress. */
  current: LineCall | null;
  calls: LineCall[];
  audio: AudioStatus;
  mic: MicStatus;
  muted: boolean;
  busy: boolean;
  /** Full-screen call UI is showing (false = minimized to the pill). */
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  dial: (deviceId: string, number: string) => Promise<boolean>;
  answer: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  /** Bumped whenever a call ends so history lists can refresh. */
  historyVersion: number;
  /** The Android phone paired over AirSIM, when there is one. */
  airsim: AirSIMStatus | null;
  refreshAirSIM: () => Promise<void>;
}

const CallContext = createContext<CallState | null>(null);

export function useCalls() {
  const value = useContext(CallContext);
  if (!value) throw new Error("useCalls must be used inside CallProvider");
  return value;
}

/**
 * Owns every browser call for the signed-in session, so a call keeps its
 * audio while the user moves between screens and incoming calls ring on
 * any page.
 */
export function CallProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [deviceLines, setLines] = useState<DeviceListItem[]>([]);
  const [airsim, setAirSIM] = useState<AirSIMStatus | null>(null);
  const [linesLoaded, setLinesLoaded] = useState(false);
  const [calls, setCalls] = useState<LineCall[]>([]);
  const [audio, setAudio] = useState<AudioStatus>("off");
  const [mic, setMic] = useState<MicStatus>("pending");
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const previous = useRef(new Map<string, string>());
  const airsimCallsRef = useRef<LineCall[]>([]);
  const audioHandle = useRef<CallAudioHandle | null>(null);
  const onPhonePage = pathname.startsWith("/phone");

  const refreshLines = useCallback(async () => {
    try {
      const result = await api<DevicesResponse>("/devices");
      setLines(result?.devices || []);
    } catch {
      /* keep the last list; the phone page shows its own errors */
    } finally {
      setLinesLoaded(true);
    }
  }, []);

  // Lines refresh quickly on the phone screen, slowly elsewhere.
  useEffect(() => {
    void refreshLines();
    const timer = window.setInterval(() => void refreshLines(), onPhonePage ? 5000 : 20000);
    return () => window.clearInterval(timer);
  }, [refreshLines, onPhonePage]);

  // The paired Android phone follows its own event stream: Halo long-polls
  // /airsim/events, which answers as soon as the phone's state changes.
  const refreshAirSIM = useCallback(async () => {
    try {
      setAirSIM(await api<AirSIMStatus>("/airsim"));
    } catch {
      /* AirSIM is optional */
    }
  }, []);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const controller = new AbortController();
    const loop = async () => {
      while (active) {
        try {
          const status = await api<AirSIMStatus>(`/airsim/events?after=${revision}`, { timeoutMs: 35000, signal: controller.signal });
          if (!active) return;
          revision = status.revision;
          setAirSIM(status);
          if (!status.paired) await new Promise((resolve) => window.setTimeout(resolve, 15000));
        } catch {
          if (!active) return;
          await new Promise((resolve) => window.setTimeout(resolve, 5000));
        }
      }
    };
    void loop();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const lines = useMemo(
    () => (airsim?.paired ? [...deviceLines, airsimLine(airsim)] : deviceLines),
    [deviceLines, airsim],
  );
  const airsimCalls = useMemo<LineCall[]>(
    () => (airsim?.call ? [{ ...airsimCall(airsim.call), deviceId: AIRSIM_LINE_ID }] : []),
    [airsim?.call?.id, airsim?.call?.state, airsim?.call?.number], // eslint-disable-line react-hooks/exhaustive-deps
  );

  airsimCallsRef.current = airsimCalls;

  const readyIds = useMemo(
    () => deviceLines.filter(lineReady).map((line) => line.id).join("\n"),
    [deviceLines],
  );

  useEffect(() => {
    const ids = readyIds ? readyIds.split("\n") : [];
    let active = true;
    const load = async () => {
      const results = await Promise.all(
        ids.map((id) =>
          api<CallsResponse>(`/devices/${encodeURIComponent(id)}/calls`)
            .then((result) => (result?.calls || []).map((call) => ({ ...call, deviceId: id })))
            .catch(() => [] as LineCall[]),
        ),
      );
      if (!active) return;
      const next = [...results.flat(), ...airsimCallsRef.current];
      let ended = false;
      for (const call of next) {
        const before = previous.current.get(call.id);
        if (call.direction === "incoming" && call.state === "ringing" && before !== "ringing") notifyIncoming(call, t);
        if (before && isLive({ ...call, state: before }) && !isLive(call)) ended = true;
        previous.current.set(call.id, call.state);
      }
      // A call that vanished from the list also ended.
      for (const [id, state] of previous.current) {
        if (!next.some((call) => call.id === id)) {
          if (isLive({ id, direction: "", state })) ended = true;
          previous.current.delete(id);
        }
      }
      if (ended) setHistoryVersion((value) => value + 1);
      setCalls(next);
    };
    void load();
    const timer = window.setInterval(() => void load(), document.hidden ? 4000 : 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [readyIds, t, airsimCalls]);

  const current = useMemo(() => {
    const live = calls.filter(isLive);
    return live.find((call) => callPhase(call) === "incoming") ?? live[0] ?? null;
  }, [calls]);

  // A new call opens the full-screen UI; when nothing is live it closes.
  const currentId = current?.id;
  const currentPhase = current ? callPhase(current) : null;
  useEffect(() => {
    if (!currentId) {
      setExpanded(false);
      setMuted(false);
    } else if (currentPhase !== "incoming") {
      setExpanded(true);
    }
  }, [currentId, currentPhase]);

  // Audio follows the focused call once its media is ready.
  const mediaCall = current && current.mediaReady && ["active", "early_media"].includes(current.state) ? current : null;
  useEffect(() => {
    if (!mediaCall) {
      setAudio("off");
      return;
    }
    const handle = startCallAudio({
      deviceId: mediaCall.deviceId,
      callId: mediaCall.id,
      mediaPath: mediaCall.deviceId === AIRSIM_LINE_ID ? "/api/airsim/calls/media" : undefined,
      onStatus: setAudio,
      onMic: setMic,
    });
    audioHandle.current = handle;
    return () => {
      handle.stop();
      audioHandle.current = null;
    };
  }, [mediaCall?.deviceId, mediaCall?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = useCallback(async (deviceId: string, name: "dial" | "answer" | "hangup", body: Record<string, string>) => {
    setBusy(true);
    try {
      const path = deviceId === AIRSIM_LINE_ID ? `/airsim/calls/${name}` : `/devices/${encodeURIComponent(deviceId)}/calls/${name}`;
      await api(path, { method: "POST", body, timeoutMs: 15000 });
      if (deviceId === AIRSIM_LINE_ID) void refreshAirSIM();
      return true;
    } catch (error) {
      message.error(apiMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, [refreshAirSIM]);

  const value = useMemo<CallState>(
    () => ({
      lines,
      linesLoaded,
      refreshLines,
      current,
      calls,
      audio,
      mic,
      muted,
      busy,
      expanded,
      setExpanded,
      historyVersion,
      airsim,
      refreshAirSIM,
      dial: async (deviceId, number) => {
        const ok = await post(deviceId, "dial", { number: number.trim() });
        if (ok) setExpanded(true);
        return ok;
      },
      answer: async () => {
        if (!current) return;
        if (await post(current.deviceId, "answer", { call_id: current.id })) setExpanded(true);
      },
      hangup: async () => {
        if (current) await post(current.deviceId, "hangup", { call_id: current.id });
      },
      toggleMute: () => {
        setMuted((value) => {
          audioHandle.current?.setMuted(!value);
          return !value;
        });
      },
    }),
    [lines, linesLoaded, refreshLines, current, calls, audio, mic, muted, busy, expanded, historyVersion, post, airsim, refreshAirSIM],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallOverlay />
    </CallContext.Provider>
  );
}

function notifyIncoming(call: LineCall, t: (text: string) => string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try {
      new Notification(t("来电"), { body: call.number || t("未知号码"), tag: `call-${call.id}` });
    } catch {
      /* some mobile browsers only allow notifications from a service worker */
    }
  } else if (Notification.permission === "default") {
    void Notification.requestPermission();
  }
}
