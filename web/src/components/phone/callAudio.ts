// Browser call audio: 8 kHz signed 16-bit mono PCM over the call media
// WebSocket. Playback never depends on the microphone: when the browser
// refuses microphone access (plain HTTP on a LAN address, or a denied
// prompt) the call continues in listen-only mode.
//
// Audio runs in an AudioWorklet (callAudio.worklet.ts) with a jitter buffer
// and a band-limited resampler (callAudioDsp.ts). Browsers only offer
// AudioWorklet on HTTPS; on plain HTTP the same processing runs in a
// ScriptProcessorNode with a deeper buffer.

import workletUrl from "./callAudio.worklet.ts?worker&url";
import { DownlinkPlayer, UplinkFramer } from "./callAudioDsp";

export type AudioStatus = "off" | "connecting" | "ready" | "error";
export type MicStatus = "pending" | "on" | "muted" | "insecure" | "denied" | "unavailable";

export interface CallAudioHandle {
  setMuted(muted: boolean): void;
  stop(): void;
}

export function micUnavailableReason(status: MicStatus): string {
  switch (status) {
    case "insecure":
      return "当前页面不是 HTTPS，浏览器不允许使用麦克风：只能听，不能说。请用 HTTPS 或 localhost 打开 Halo。";
    case "denied":
      return "麦克风权限被拒绝：只能听，不能说。请在浏览器地址栏允许麦克风后重新接通。";
    case "unavailable":
      return "没有找到可用的麦克风：只能听，不能说。";
    default:
      return "";
  }
}

export function startCallAudio({
  deviceId,
  callId,
  mediaPath,
  onStatus,
  onMic,
}: {
  deviceId: string;
  callId: string;
  /** Overrides the device call media endpoint (the AirSIM phone has its own). */
  mediaPath?: string;
  onStatus: (status: AudioStatus) => void;
  onMic: (status: MicStatus) => void;
}): CallAudioHandle {
  let closed = false;
  let muted = false;
  let socket: WebSocket | undefined;
  let audioContext: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | ScriptProcessorNode | undefined;
  /** Delivers one downlink frame to whichever engine is running. */
  let deliver: (samples: ArrayBuffer) => void = () => undefined;
  let applyMute: (muted: boolean) => void = () => undefined;

  onStatus("connecting");
  onMic("pending");

  const send = (frame: ArrayBuffer) => {
    if (!muted && socket?.readyState === WebSocket.OPEN) socket.send(frame);
  };

  const startWorklet = async (context: AudioContext) => {
    await context.audioWorklet.addModule(workletUrl);
    const worklet = new AudioWorkletNode(context, "halo-call-audio", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
    });
    worklet.port.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) send(event.data);
    };
    deliver = (samples) => worklet.port.postMessage({ type: "downlink", samples }, [samples]);
    applyMute = (value) => worklet.port.postMessage({ type: "mute", muted: value });
    worklet.connect(context.destination);
    return worklet;
  };

  // No AudioWorklet (plain HTTP, old browsers): the same DSP on the main
  // thread. 2048-sample callbacks arrive in bursts, so the buffer starts deeper.
  const startScriptProcessor = (context: AudioContext) => {
    const player = new DownlinkPlayer(context.sampleRate, { target: 1200, minTarget: 800, maxTarget: 3200 });
    const framer = new UplinkFramer(context.sampleRate);
    const processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      player.render(event.outputBuffer.getChannelData(0));
      if (source) for (const frame of framer.push(event.inputBuffer.getChannelData(0))) send(frame.buffer as ArrayBuffer);
    };
    deliver = (samples) => player.push(new Int16Array(samples));
    processor.connect(context.destination);
    return processor;
  };

  const openMicrophone = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onMic("insecure");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (error) {
      const name = (error as DOMException)?.name;
      onMic(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      return;
    }
    if (closed || !audioContext || !node) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    source = audioContext.createMediaStreamSource(stream);
    source.connect(node);
    applyMute(muted);
    onMic(muted ? "muted" : "on");
  };

  const setup = async () => {
    try {
      audioContext = new AudioContext({ latencyHint: "interactive" });
      await audioContext.resume();
    } catch {
      if (!closed) onStatus("error");
      return;
    }
    try {
      node = audioContext.audioWorklet ? await startWorklet(audioContext) : startScriptProcessor(audioContext);
    } catch {
      node = startScriptProcessor(audioContext);
    }
    if (closed) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const path = mediaPath ?? `/api/devices/${encodeURIComponent(deviceId)}/calls/media`;
    socket = new WebSocket(`${protocol}//${window.location.host}${path}?call_id=${encodeURIComponent(callId)}`);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      if (!closed) onStatus("ready");
    };
    socket.onerror = () => {
      if (!closed) onStatus("error");
    };
    socket.onclose = () => {
      if (!closed) onStatus("off");
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") return;
      const data = event.data as ArrayBuffer;
      if (data.byteLength < 2) return;
      deliver(data.byteLength % 2 ? data.slice(0, data.byteLength - 1) : data);
    };
    // The microphone is optional; playback is already running.
    void openMicrophone();
  };
  void setup();

  return {
    setMuted(next: boolean) {
      muted = next;
      applyMute(next);
      if (stream) onMic(next ? "muted" : "on");
    },
    stop() {
      closed = true;
      source?.disconnect();
      node?.disconnect();
      if (node && "port" in node) node.port.onmessage = null;
      stream?.getTracks().forEach((track) => track.stop());
      socket?.close();
      void audioContext?.close();
    },
  };
}
