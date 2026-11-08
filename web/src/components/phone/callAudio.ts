// Browser call audio: 8 kHz signed 16-bit mono PCM over the call media
// WebSocket. Playback never depends on the microphone: when the browser
// refuses microphone access (plain HTTP on a LAN address, or a denied
// prompt) the call continues in listen-only mode.

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
  let processor: ScriptProcessorNode | undefined;
  let sink: GainNode | undefined;
  let playbackTime = 0;

  onStatus("connecting");
  onMic("pending");

  const openMicrophone = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onMic("insecure");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      const name = (error as DOMException)?.name;
      onMic(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      return;
    }
    if (closed || !audioContext) return;
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      if (muted || !socket || socket.readyState !== WebSocket.OPEN || !audioContext) return;
      const input = event.inputBuffer.getChannelData(0);
      const ratio = audioContext.sampleRate / 8000;
      const output = new Int16Array(Math.floor(input.length / ratio));
      // Box-filter each output sample over its source window; plain
      // decimation aliases high frequencies into the 4 kHz voice band.
      for (let index = 0; index < output.length; index += 1) {
        const from = Math.floor(index * ratio);
        const to = Math.min(input.length, Math.floor((index + 1) * ratio));
        let sum = 0;
        for (let cursor = from; cursor < to; cursor += 1) sum += input[cursor];
        const sample = Math.max(-1, Math.min(1, sum / Math.max(1, to - from)));
        output[index] = sample < 0 ? sample * 32768 : sample * 32767;
      }
      socket.send(output.buffer);
    };
    source.connect(processor);
    sink = audioContext.createGain();
    sink.gain.value = 0;
    processor.connect(sink);
    sink.connect(audioContext.destination);
    onMic(muted ? "muted" : "on");
  };

  const setup = async () => {
    try {
      audioContext = new AudioContext();
      await audioContext.resume();
    } catch {
      if (!closed) onStatus("error");
      return;
    }
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
      if (!audioContext || typeof event.data === "string") return;
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
      if (!samples.length) return;
      const buffer = audioContext.createBuffer(1, samples.length, 8000);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 32768;
      const player = audioContext.createBufferSource();
      player.buffer = buffer;
      player.connect(audioContext.destination);
      // Resynchronize when playback has drifted far behind (tab throttled).
      if (playbackTime - audioContext.currentTime > 0.5) playbackTime = audioContext.currentTime;
      const startAt = Math.max(audioContext.currentTime, playbackTime);
      playbackTime = startAt + buffer.duration;
      player.start(startAt);
    };
    // The microphone is optional; playback is already running.
    void openMicrophone();
  };
  void setup();

  return {
    setMuted(next: boolean) {
      muted = next;
      if (stream) onMic(next ? "muted" : "on");
    },
    stop() {
      closed = true;
      processor?.disconnect();
      sink?.disconnect();
      source?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      socket?.close();
      void audioContext?.close();
    },
  };
}
