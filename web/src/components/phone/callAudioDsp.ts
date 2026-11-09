// Call audio signal processing, shared by the AudioWorklet and the
// main-thread fallback. No imports: the worklet bundle and the unit tests
// load this file on its own.
//
// The call side of Halo speaks 8 kHz signed 16-bit mono PCM in 20 ms
// frames. The browser runs at its device rate (44.1 or 48 kHz). Two things
// made calls sound rough before this file existed:
//   - every 20 ms downlink frame was its own AudioBufferSourceNode, so the
//     browser resampled each one separately and clicked at every boundary,
//     and a late frame left a gap because nothing was buffered ahead;
//   - the microphone was decimated with a 6-sample box average, which lets
//     4–8 kHz hiss fold back into the voice band, and dropped the
//     fractional remainder of every block, a tiny jump each 43 ms.
// Here both directions go through one band-limited resampler that keeps its
// state across blocks, and the downlink plays out of an adaptive jitter
// buffer.

export const VOICE_RATE = 8000;
export const FRAME_SAMPLES = VOICE_RATE / 50;

const KERNEL_RESOLUTION = 256;

/** sinc(u)·Blackman(u/zeros) for u in [0, zeros], sampled 256 times per zero crossing. */
function buildKernel(zeros: number): Float32Array {
  const size = zeros * KERNEL_RESOLUTION + 2;
  const table = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const u = index / KERNEL_RESOLUTION;
    if (u >= zeros) {
      table[index] = 0;
      continue;
    }
    const sinc = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
    const x = 0.5 + u / (2 * zeros); // Blackman window centred on u = 0
    const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
    table[index] = sinc * window;
  }
  return table;
}

const kernels = new Map<number, Float32Array>();
function kernelFor(zeros: number): Float32Array {
  let table = kernels.get(zeros);
  if (!table) {
    table = buildKernel(zeros);
    kernels.set(zeros, table);
  }
  return table;
}

/**
 * Streaming windowed-sinc resampler. Its filter state carries across
 * push/pull calls, so block boundaries are inaudible. The step can be nudged
 * a little (setSpeed) to follow clock drift without dropping samples.
 */
export class Resampler {
  private readonly gain: number;
  private readonly half: number;
  private readonly kernel: Float32Array;
  private readonly baseStep: number;
  private step: number;
  private buffer: Float32Array;
  private length: number;
  private time: number;

  constructor(inRate: number, outRate: number, cutoffHz: number, zeros = 8) {
    this.gain = Math.min(1, (2 * cutoffHz) / inRate);
    this.half = zeros / this.gain;
    this.kernel = kernelFor(zeros);
    this.baseStep = inRate / outRate;
    this.step = this.baseStep;
    this.buffer = new Float32Array(Math.max(1024, Math.ceil(this.half * 4)));
    // Left context starts as silence, so the first output lines up with
    // the first real input sample.
    this.length = Math.ceil(this.half);
    this.time = this.length;
  }

  /** 1 plays at the nominal rate; 1.01 consumes input 1% faster. */
  setSpeed(speed: number) {
    this.step = this.baseStep * speed;
  }

  push(samples: ArrayLike<number>, scale = 1) {
    this.compact();
    const need = this.length + samples.length;
    if (need > this.buffer.length) {
      const grown = new Float32Array(Math.max(need, this.buffer.length * 2));
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    for (let index = 0; index < samples.length; index += 1) this.buffer[this.length + index] = samples[index] * scale;
    this.length = need;
  }

  /** Writes as many outputs as the buffered input allows, up to `count`. */
  pull(out: Float32Array, offset: number, count: number): number {
    const { buffer, kernel, gain, half } = this;
    let produced = 0;
    while (produced < count) {
      const t = this.time;
      const last = Math.floor(t + half);
      if (last >= this.length) break;
      let first = Math.ceil(t - half);
      if (first < 0) first = 0;
      let sum = 0;
      for (let k = first; k <= last; k += 1) {
        let position = Math.abs(t - k) * gain * KERNEL_RESOLUTION;
        const index = position | 0;
        position -= index;
        sum += buffer[k] * (kernel[index] + (kernel[index + 1] - kernel[index]) * position);
      }
      out[offset + produced] = sum * gain;
      produced += 1;
      this.time += this.step;
    }
    return produced;
  }

  /** Drops input that no future output can reach. */
  private compact() {
    const drop = Math.floor(this.time - this.half) - 1;
    if (drop < this.buffer.length / 2) return;
    this.buffer.copyWithin(0, drop, this.length);
    this.length -= drop;
    this.time -= drop;
  }

  /** Kernel half-width, in input samples. Exposed for tests. */
  get halfWidth() {
    return this.half;
  }
}

export interface PlayerOptions {
  /** Starting playout delay, in 8 kHz samples. */
  target?: number;
  minTarget?: number;
  maxTarget?: number;
}

export interface PlayerStats {
  buffered: number;
  target: number;
  underruns: number;
  dropped: number;
}

const FADE = 80; // 10 ms at 8 kHz

/**
 * Downlink playout: an adaptive jitter buffer in front of an 8 kHz → device
 * rate resampler.
 *
 * Frames are held until `target` samples are queued, then played. When the
 * queue runs dry the tail fades out, the target grows by 40 ms and playback
 * waits for the queue to refill; after a quiet stretch the target eases back
 * down. Slow clock drift and small bursts are absorbed by playing up to
 * 1.5% faster while the queue sits well above target (or a
 * little slower when it runs low). A backlog beyond 400 ms
 * (a throttled background tab) is cut back to the target.
 */
export class DownlinkPlayer {
  private readonly resampler: Resampler;
  private readonly outRate: number;
  private readonly minTarget: number;
  private readonly maxTarget: number;
  private queue = new Float32Array(VOICE_RATE * 2);
  private head = 0;
  private size = 0;
  private playing = false;
  private fadeIn = 0;
  private level = 0;
  private sinceUnderrun = 0;
  private readonly chunk = new Float32Array(32);
  target: number;
  underruns = 0;
  dropped = 0;

  constructor(outRate: number, options: PlayerOptions = {}) {
    this.outRate = outRate;
    this.resampler = new Resampler(VOICE_RATE, outRate, 3800, 8);
    this.minTarget = options.minTarget ?? 480;
    this.maxTarget = options.maxTarget ?? 2400;
    this.target = Math.min(this.maxTarget, Math.max(this.minTarget, options.target ?? 800));
  }

  get buffered() {
    return this.size;
  }

  stats(): PlayerStats {
    return { buffered: this.size, target: this.target, underruns: this.underruns, dropped: this.dropped };
  }

  push(samples: Int16Array) {
    if (this.size + samples.length > this.queue.length) {
      const grown = new Float32Array(Math.max(this.queue.length * 2, this.size + samples.length));
      for (let index = 0; index < this.size; index += 1) grown[index] = this.queue[(this.head + index) % this.queue.length];
      this.queue = grown;
      this.head = 0;
    }
    const capacity = this.queue.length;
    let tail = (this.head + this.size) % capacity;
    for (let index = 0; index < samples.length; index += 1) {
      this.queue[tail] = samples[index] / 32768;
      tail += 1;
      if (tail === capacity) tail = 0;
    }
    this.size += samples.length;
    const ceiling = Math.max(this.target + 1600, 3200);
    if (this.size > ceiling) {
      const excess = this.size - this.target;
      this.head = (this.head + excess) % capacity;
      this.size -= excess;
      this.dropped += excess;
      this.level = this.size;
    }
  }

  /** Fills `out` with device-rate samples; silence while buffering. */
  render(out: Float32Array) {
    let done = 0;
    while (done < out.length) {
      done += this.resampler.pull(out, done, out.length - done);
      if (done < out.length) this.feed();
    }
    this.track(out.length);
  }

  /** Moves one small chunk from the queue (or silence) into the resampler. */
  private feed() {
    const chunk = this.chunk;
    if (!this.playing && this.size >= this.target) {
      this.playing = true;
      this.fadeIn = FADE;
    }
    if (!this.playing) {
      chunk.fill(0);
      this.resampler.push(chunk);
      return;
    }
    const take = Math.min(chunk.length, this.size);
    const capacity = this.queue.length;
    for (let index = 0; index < take; index += 1) {
      let sample = this.queue[this.head];
      this.head += 1;
      if (this.head === capacity) this.head = 0;
      if (this.fadeIn > 0) {
        sample *= 1 - this.fadeIn / FADE;
        this.fadeIn -= 1;
      }
      chunk[index] = sample;
    }
    this.size -= take;
    if (this.size === 0) {
      // Ran dry: fade what we have so the cut is not a click, then wait.
      const fade = Math.min(take, FADE);
      for (let index = 0; index < fade; index += 1) chunk[take - fade + index] *= 1 - (index + 1) / fade;
      for (let index = take; index < chunk.length; index += 1) chunk[index] = 0;
      this.playing = false;
      this.underruns += 1;
      this.sinceUnderrun = 0;
      this.target = Math.min(this.maxTarget, this.target + 2 * FRAME_SAMPLES);
    }
    this.resampler.push(chunk);
  }

  private track(rendered: number) {
    this.level += (this.size - this.level) * 0.02;
    this.sinceUnderrun += rendered / this.outRate;
    if (this.sinceUnderrun > 15 && this.target > this.minTarget) {
      this.target = Math.max(this.minTarget, this.target - 40);
      this.sinceUnderrun = 10;
    }
    if (!this.playing) {
      this.resampler.setSpeed(1);
      return;
    }
    // A dead band around the target keeps the pitch steady: the level
    // naturally swings by a frame or two between arrivals.
    const high = this.level - (this.target + 320);
    const low = this.target / 2 - this.level;
    if (high > 0) this.resampler.setSpeed(1 + Math.min(0.015, high / 16000));
    else if (low > 0) this.resampler.setSpeed(1 - Math.min(0.005, low / 16000));
    else this.resampler.setSpeed(1);
  }
}

/**
 * Uplink: device-rate microphone samples → 20 ms frames of 8 kHz PCM16,
 * low-passed at 3.6 kHz before decimation.
 */
export class UplinkFramer {
  private readonly resampler: Resampler;
  private readonly scratch = new Float32Array(FRAME_SAMPLES);
  private frame = new Int16Array(FRAME_SAMPLES);
  private filled = 0;

  constructor(inRate: number) {
    this.resampler = new Resampler(inRate, VOICE_RATE, 3600, 8);
  }

  /** Returns every frame completed by this block (often none). */
  push(input: Float32Array): Int16Array[] {
    this.resampler.push(input);
    const frames: Int16Array[] = [];
    for (;;) {
      const count = this.resampler.pull(this.scratch, 0, FRAME_SAMPLES - this.filled);
      for (let index = 0; index < count; index += 1) {
        const sample = Math.max(-1, Math.min(1, this.scratch[index]));
        this.frame[this.filled + index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
      }
      this.filled += count;
      if (this.filled < FRAME_SAMPLES) break;
      frames.push(this.frame);
      this.frame = new Int16Array(FRAME_SAMPLES);
      this.filled = 0;
    }
    return frames;
  }
}
