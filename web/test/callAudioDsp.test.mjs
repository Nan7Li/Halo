import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/components/phone/callAudioDsp.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const dsp = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

function sine(rate, hz, seconds, amplitude = 0.5, phase = 0) {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = amplitude * Math.sin(phase + (2 * Math.PI * hz * i) / rate);
  return out;
}

/** Amplitude of `hz` in `samples` (single-bin DFT). */
function tone(samples, rate, hz) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < samples.length; i += 1) {
    re += samples[i] * Math.cos((2 * Math.PI * hz * i) / rate);
    im -= samples[i] * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return (2 * Math.hypot(re, im)) / samples.length;
}

function uplink(rate, signal, block = 128) {
  const framer = new dsp.UplinkFramer(rate);
  const frames = [];
  for (let at = 0; at < signal.length; at += block) frames.push(...framer.push(signal.subarray(at, at + block)));
  const pcm = new Float32Array(frames.length * dsp.FRAME_SAMPLES);
  frames.forEach((frame, index) => frame.forEach((value, offset) => (pcm[index * dsp.FRAME_SAMPLES + offset] = value / 32768)));
  return { frames, pcm };
}

for (const rate of [48000, 44100]) {
  test(`uplink at ${rate} Hz keeps voice and every sample`, () => {
    const { frames, pcm } = uplink(rate, sine(rate, 1000, 2));
    assert.ok(frames.every((frame) => frame.length === 160));
    // 2 s in → 2 s out, minus the filter's half-width of latency.
    assert.ok(pcm.length >= 16000 - 320 && pcm.length <= 16000, `got ${pcm.length}`);
    const steady = pcm.subarray(800, 800 + 8000);
    assert.ok(Math.abs(tone(steady, 8000, 1000) - 0.5) < 0.01);
  });

  test(`uplink at ${rate} Hz rejects what would alias into the voice band`, () => {
    // 6 kHz folds to 2 kHz at 8 kHz; the old box filter let ~20% through.
    const { pcm } = uplink(rate, sine(rate, 6000, 1));
    const steady = pcm.subarray(800, 800 + 4000);
    assert.ok(tone(steady, 8000, 2000) < 0.5 * 0.003, `alias ${tone(steady, 8000, 2000)}`);
  });
}

function frames8k(hz, seconds) {
  const signal = sine(8000, hz, seconds);
  const frames = [];
  for (let at = 0; at < signal.length; at += 160) {
    frames.push(Int16Array.from(signal.subarray(at, at + 160), (value) => Math.round(value * 32767)));
  }
  return frames;
}

function play(player, rate, frames, schedule) {
  const out = [];
  const block = new Float32Array(128);
  let next = 0;
  const total = Math.round(rate * schedule.seconds);
  for (let rendered = 0; rendered < total; rendered += 128) {
    const now = rendered / rate;
    while (next < frames.length && schedule.arrival(next) <= now) player.push(frames[next++]);
    player.render(block);
    out.push(...block);
  }
  return Float32Array.from(out);
}

test("downlink plays 20 ms frames back to back without clicks", () => {
  const rate = 48000;
  const player = new dsp.DownlinkPlayer(rate);
  const out = play(player, rate, frames8k(440, 3), { seconds: 3, arrival: (index) => index * 0.02 });
  assert.equal(player.underruns, 0);
  // A click is a jump far above what a 440 Hz, 0.5 amplitude sine can do per sample.
  const steady = out.subarray(rate * 0.5, rate * 2.5);
  let jump = 0;
  for (let i = 1; i < steady.length; i += 1) jump = Math.max(jump, Math.abs(steady[i] - steady[i - 1]));
  assert.ok(jump < 0.5 * 2 * Math.PI * (440 / rate) * 1.1, `largest step ${jump}`);
  assert.ok(Math.abs(tone(steady, rate, 440) - 0.5) < 0.02);
});

test("downlink rides out bursty arrival after one adaptation", () => {
  const rate = 48000;
  const player = new dsp.DownlinkPlayer(rate);
  // arecord with 128 ms periods: six or seven frames at once, then nothing.
  play(player, rate, frames8k(440, 8), { seconds: 8, arrival: (index) => Math.floor((index * 0.02) / 0.128) * 0.128 + 0.128 });
  assert.ok(player.underruns <= 2, `underruns ${player.underruns}`);
});

test("downlink grows its buffer after a gap and plays silence meanwhile", () => {
  const rate = 48000;
  const player = new dsp.DownlinkPlayer(rate);
  const before = player.target;
  const out = play(player, rate, frames8k(440, 2), {
    seconds: 2.25,
    arrival: (index) => index * 0.02 + (index >= 50 ? 0.3 : 0),
  });
  assert.equal(player.underruns, 1);
  assert.ok(player.target > before);
  assert.ok(Number.isFinite(out.reduce((a, b) => a + b, 0)));
});

test("downlink follows a sender clock 0.5% fast without piling up", () => {
  const rate = 48000;
  const player = new dsp.DownlinkPlayer(rate);
  play(player, rate, frames8k(440, 30), { seconds: 30, arrival: (index) => (index * 0.02) / 1.005 });
  assert.ok(player.buffered < player.target + 800, `buffered ${player.buffered}`);
  assert.equal(player.dropped, 0);
});

test("downlink cuts a backlog from a throttled tab", () => {
  const player = new dsp.DownlinkPlayer(48000);
  for (const frame of frames8k(440, 2)) player.push(frame);
  assert.ok(player.buffered <= 3200);
  assert.ok(player.dropped > 0);
});
