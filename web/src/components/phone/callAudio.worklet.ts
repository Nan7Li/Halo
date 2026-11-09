// AudioWorklet side of browser call audio. Runs on the audio thread, so
// page animations and React rendering cannot starve it.
//
// Messages in:  { type: "downlink", samples: ArrayBuffer }  8 kHz PCM16
//               { type: "mute", muted: boolean }
// Messages out: ArrayBuffer of one 20 ms 8 kHz PCM16 uplink frame
//               { type: "stats", ... } about once a second

import { DownlinkPlayer, UplinkFramer } from "./callAudioDsp";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: unknown): void;

class CallAudioProcessor extends AudioWorkletProcessor {
  private readonly player = new DownlinkPlayer(sampleRate);
  private readonly framer = new UplinkFramer(sampleRate);
  private muted = false;
  private sinceStats = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; samples?: ArrayBuffer; muted?: boolean };
      if (data.type === "downlink" && data.samples) {
        this.player.push(new Int16Array(data.samples));
      } else if (data.type === "mute") {
        this.muted = Boolean(data.muted);
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0];
    if (output?.[0]) {
      this.player.render(output[0]);
      for (let channel = 1; channel < output.length; channel += 1) output[channel].set(output[0]);
    }
    const input = inputs[0]?.[0];
    if (input) {
      // Keep the filter running while muted so unmuting starts clean.
      const frames = this.framer.push(input);
      if (!this.muted) for (const frame of frames) this.port.postMessage(frame.buffer, [frame.buffer]);
    }
    this.sinceStats += output?.[0]?.length ?? 128;
    if (this.sinceStats >= sampleRate) {
      this.sinceStats = 0;
      this.port.postMessage({ type: "stats", ...this.player.stats() });
    }
    return true;
  }
}

registerProcessor("halo-call-audio", CallAudioProcessor);
