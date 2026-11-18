#!/usr/bin/env node
// Runs every audio effect through the real FFmpeg binary on a synthetic stereo
// signal and checks that each filter string is valid and audibly changes the
// sound in the intended way. Usage: node scripts/effects-check.cjs
"use strict";
const { spawnSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const { EFFECTS, EFFECT_NAMES, effectChain, effectsRate } = require("../src/audio-effects");

const RATE = 48000;
const SECONDS = 4;
// Centre (identical L/R): 60 Hz bass, 440 Hz "vocal", 5 kHz air.
// Sides: 1 kHz left only, 1.5 kHz right only.
const centre = "0.25*sin(2*PI*60*t)+0.25*sin(2*PI*440*t)+0.08*sin(2*PI*5000*t)";
const SOURCE = `aevalsrc=${centre}+0.15*sin(2*PI*1000*t)|${centre}+0.15*sin(2*PI*1500*t):s=${RATE}:d=${SECONDS}`;

function render(chain) {
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", SOURCE,
    ...(chain.length ? ["-af", chain.join(",")] : []), "-f", "s16le", "-ar", String(RATE), "-ac", "2", "pipe:1"];
  const result = spawnSync(ffmpeg, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error(`FFmpeg rejected the chain: ${result.stderr.toString().trim()}\n  -af ${chain.join(",")}`);
  const pcm = result.stdout;
  const frames = pcm.length / 4;
  const left = new Float64Array(frames), right = new Float64Array(frames);
  for (let i = 0; i < frames; i++) { left[i] = pcm.readInt16LE(i * 4) / 32768; right[i] = pcm.readInt16LE(i * 4 + 2) / 32768; }
  return { left, right, frames };
}
// Skip the first 0.5 s so filter warm-up (limiter lookahead, echoes) settles.
const settle = (signal, from = 0.5) => signal.subarray(Math.floor(RATE * from));
const rms = signal => Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / Math.max(1, signal.length));
const peak = signal => signal.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const db = ratio => 20 * Math.log10(Math.max(ratio, 1e-9));
function tone(signal, frequency) { // Goertzel magnitude
  const k = 2 * Math.cos(2 * Math.PI * frequency / RATE);
  let a = 0, b = 0;
  for (const value of signal) { const next = value + k * a - b; b = a; a = next; }
  return Math.sqrt(Math.max(0, a * a + b * b - k * a * b)) / signal.length;
}
const mid = out => out.left.map((value, i) => (value + out.right[i]) / 2);
const ratioDb = (out, f1, f2) => { const m = settle(mid(out)); return db(tone(m, f1) / tone(m, f2)); };
function balanceSwing(out) { // L/R level swing across 250 ms windows, in dB
  const size = RATE / 4; const values = [];
  for (let start = RATE / 2; start + size <= out.frames; start += size) {
    values.push(db(rms(out.left.subarray(start, start + size)) / rms(out.right.subarray(start, start + size))));
  }
  return Math.max(...values) - Math.min(...values);
}
function envelopeSwing(out) { // volume swing across 20 ms windows, in dB
  const size = RATE / 50; const values = []; const m = mid(out);
  for (let start = RATE / 2; start + size <= out.frames; start += size) values.push(db(rms(m.subarray(start, start + size))));
  return Math.max(...values) - Math.min(...values);
}
const difference = (a, b) => {
  const n = Math.min(a.frames, b.frames); let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a.left[i] - b.left[i]) + Math.abs(a.right[i] - b.right[i]);
  return sum / (2 * n) + Math.abs(a.frames - b.frames) / Math.max(a.frames, b.frames);
};

const dry = render([]);
const dryCentre = tone(settle(dry.left.map((v, i) => (v + dry.right[i]) / 2)), 440);
const checks = {
  bassboost: out => ({ ok: ratioDb(out, 60, 440) - ratioDb(dry, 60, 440) >= 10, detail: `60 Hz vs 440 Hz +${(ratioDb(out, 60, 440) - ratioDb(dry, 60, 440)).toFixed(1)} dB` }),
  treble: out => ({ ok: ratioDb(out, 5000, 440) - ratioDb(dry, 5000, 440) >= 6, detail: `5 kHz vs 440 Hz +${(ratioDb(out, 5000, 440) - ratioDb(dry, 5000, 440)).toFixed(1)} dB` }),
  eightd: out => ({ ok: balanceSwing(out) >= 10, detail: `L/R balance swing ${balanceSwing(out).toFixed(1)} dB` }),
  mono: out => { const d = out.left.reduce((max, v, i) => Math.max(max, Math.abs(v - out.right[i])), 0); return { ok: d < 1e-3, detail: `max L-R difference ${d.toFixed(5)}` }; },
  karaoke: out => { const cut = db(tone(settle(mid(out)), 440) / dryCentre); return { ok: cut <= -12, detail: `centre 440 Hz ${cut.toFixed(1)} dB` }; },
  earrape: out => { const gain = db(rms(settle(out.left)) / rms(settle(dry.left))); return { ok: gain >= 6, detail: `RMS +${gain.toFixed(1)} dB` }; },
  tremolo: out => ({ ok: envelopeSwing(out) - envelopeSwing(dry) >= 6, detail: `envelope swing ${envelopeSwing(out).toFixed(1)} dB (dry ${envelopeSwing(dry).toFixed(1)})` }),
  lofi: out => ({ ok: ratioDb(out, 5000, 440) - ratioDb(dry, 5000, 440) <= -10, detail: `5 kHz vs 440 Hz ${(ratioDb(out, 5000, 440) - ratioDb(dry, 5000, 440)).toFixed(1)} dB` }),
  pitchup: out => ({ ok: ratioDb(out, 440 * 2 ** 0.25, 440) >= 20, detail: `energy moved 440 Hz -> ${(440 * 2 ** 0.25).toFixed(0)} Hz (${ratioDb(out, 440 * 2 ** 0.25, 440).toFixed(1)} dB)` }),
  pitchdown: out => ({ ok: ratioDb(out, 440 * 2 ** -0.25, 440) >= 20, detail: `energy moved 440 Hz -> ${(440 * 2 ** -0.25).toFixed(0)} Hz (${ratioDb(out, 440 * 2 ** -0.25, 440).toFixed(1)} dB)` }),
  nightcore: out => ({ ok: ratioDb(out, 550, 440) >= 20, detail: `pitch 440 Hz -> 550 Hz (${ratioDb(out, 550, 440).toFixed(1)} dB)` }),
  vaporwave: out => ({ ok: ratioDb(out, 352, 440) >= 20, detail: `pitch 440 Hz -> 352 Hz (${ratioDb(out, 352, 440).toFixed(1)} dB)` })
};

let failures = 0;
const report = (ok, name, detail) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(10)} ${detail}`); };
for (const effect of EFFECTS) {
  const filters = { [effect.name]: true };
  let out;
  try { out = render(effectChain(filters)); }
  catch (error) { report(false, effect.name, error.message); continue; }
  const changed = difference(out, dry);
  const expectedFrames = dry.frames / effectsRate(filters);
  // Echo-style effects append a short tail at EOF; only speed effects change length.
  const lengthOk = effect.stage !== "rate" && effect.stage !== "tone" ? out.frames >= dry.frames * 0.99 && out.frames <= dry.frames * 1.2
    : Math.abs(out.frames - expectedFrames) / expectedFrames < 0.03;
  const clipOk = effect.name === "earrape" || peak(out.left) <= 0.92 && peak(out.right) <= 0.92;
  const specific = checks[effect.name]?.(out) || { ok: true, detail: "" };
  report(changed > 0.01 && lengthOk && clipOk && specific.ok, effect.name,
    `diff ${changed.toFixed(3)}, length ${(out.frames / RATE).toFixed(2)}s (want ${(expectedFrames / RATE).toFixed(2)}s), peak ${Math.max(peak(out.left), peak(out.right)).toFixed(2)}${specific.detail ? ", " + specific.detail : ""}`);
}
try {
  const all = render(effectChain(Object.fromEntries(EFFECT_NAMES.map(name => [name, true]))));
  report(all.frames > 0, "all", `every effect stacked renders (${(all.frames / RATE).toFixed(2)}s)`);
} catch (error) { report(false, "all", error.message); }
console.log(failures ? `\n${failures} effect check(s) failed.` : `\nAll ${EFFECTS.length} effects passed.`);
process.exit(failures ? 1 : 0);
