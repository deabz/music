const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseTransitionSettings, fadeLengths, fadeGain, resourceVolume, shouldFadeIn,
  TransitionController, TRANSITION_TICK_MS } = require("../src/transitions");

test("transition defaults, off, numeric bounds, invalid settings and crossfade fallback", () => {
  assert.deepEqual(parseTransitionSettings({}), { mode: "fade", seconds: 4 });
  for (const seconds of [1, 1.5, 12]) assert.equal(parseTransitionSettings({ TRANSITION_SECONDS: String(seconds) }).seconds, seconds);
  for (const value of ["", "NaN", "Infinity", "0", "13", "-1"]) assert.equal(parseTransitionSettings({ TRANSITION_SECONDS: value }).seconds, 4);
  assert.equal(parseTransitionSettings({ TRANSITION_MODE: "off" }).mode, "off");
  for (const mode of ["unknown", "crossfade", ""]) {
    const warnings = [];
    assert.equal(parseTransitionSettings({ TRANSITION_MODE: mode }, text => warnings.push(text)).mode, "fade");
    assert.equal(warnings.length, 1);
  }
});

test("smooth equal-power curve has correct boundaries, monotonic ramps and short-track scaling", () => {
  assert.deepEqual(fadeLengths(100, 2, 2), { fadeOut: 2, fadeIn: 2 });
  assert.deepEqual(fadeLengths(5, 6, 6), { fadeOut: 1, fadeIn: 1 });
  assert.equal(fadeGain(0, 100, 2, 2), 0);
  assert.equal(fadeGain(2, 100, 2, 2), 1);
  assert.equal(fadeGain(98, 100, 2, 2), 1);
  assert.equal(fadeGain(100, 100, 2, 2), 0);
  let incoming = 0, outgoing = 1;
  for (let p = 0; p <= 2; p += 0.05) {
    const a = fadeGain(p, 100, 2, 2), b = fadeGain(98 + p, 100, 2, 2);
    assert.ok(a >= incoming && a <= 1); assert.ok(b <= outgoing && b >= 0);
    incoming = a; outgoing = b;
  }
  assert.ok(fadeGain(1, 100, 2, 2) > 0.5);
  assert.equal(fadeGain(1, 0, 2, 2), 1);
});

test("fade entrance applies only to natural zero-position handovers", () => {
  const natural = { mode: "fade", natural: true };
  assert.equal(shouldFadeIn(natural), true);
  for (const event of ["skip", "previous", "stop", "seek", "effects", "retry", "voice", "empty-queue"]) {
    assert.equal(shouldFadeIn({ ...natural, natural: false, event }), false);
  }
  for (const change of [{ mode: "off" }, { restoring: true }, { loop: "track" }, { restart: true }, { position: 12 }]) {
    assert.equal(shouldFadeIn({ ...natural, ...change }), false);
  }
  assert.equal(shouldFadeIn({ ...natural, loop: "queue" }), true);
});

function fixture(mode = "fade") {
  const timers = new Map(), volumes = [];
  let id = 0;
  const resource = { playbackDuration: 0, volume: { setVolume: value => volumes.push(value) } };
  const state = { current: { duration: 100 }, volume: 80, resource, player: { state: { status: "idle" } } };
  const controller = new TransitionController(state, { mode, seconds: 4 }, {
    setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimer: timer => timers.delete(timer)
  });
  const at = seconds => { resource.playbackDuration = seconds * 1000; controller.refresh(); };
  return { state, resource, controller, timers, volumes, at };
}

test("first sample is silent on natural entrance; base volume remains independent of gain", () => {
  const f = fixture(); f.controller.start(f.resource, { fadeIn: true });
  assert.equal(f.volumes[0], 0); assert.equal(f.state.volume, 80);
  f.state.player.state.status = "playing"; f.at(1);
  assert.equal([...f.timers.values()][0].ms, TRANSITION_TICK_MS);
  assert.ok(Math.abs(f.volumes.at(-1) - 0.8 * Math.SQRT1_2) < 1e-12);
  f.state.volume = 120; f.controller.refresh();
  assert.ok(Math.abs(f.volumes.at(-1) - 1.2 * Math.SQRT1_2) < 1e-12);
  f.at(5); assert.equal(f.volumes.at(-1), 1.2); assert.equal(f.state.volume, 120);
  assert.equal(resourceVolume(120, 0.5), 0.6); assert.equal(resourceVolume(120, 0, "off"), 1.2);
});

test("outside the window uses one wake-up, pause freezes ramp and resume uses delivered audio", () => {
  const f = fixture(); f.controller.start(f.resource); f.state.player.state.status = "playing"; f.at(50);
  assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].ms, 48000);
  f.at(99); const gain = f.controller.gain;
  f.state.player.state.status = "paused"; f.controller.refresh();
  assert.equal(f.timers.size, 0); assert.equal(f.controller.gain, gain);
  f.controller.refresh(); assert.equal(f.controller.gain, gain);
  f.state.player.state.status = "playing"; f.controller.refresh();
  assert.equal(f.timers.size, 1); f.at(99.5); assert.ok(f.controller.gain < gain);
});

test("seek/effect/retry resource restart recomputes fade-out immediately; seek out restores base volume", () => {
  const f = fixture(); f.controller.start(f.resource);
  f.state.resumeOffsetSeconds = 99; f.controller.start(f.resource);
  assert.ok(f.controller.gain < 1 && f.controller.gain > 0);
  f.state.resumeOffsetSeconds = 20; f.controller.start(f.resource);
  assert.equal(f.controller.gain, 1); assert.equal(f.volumes.at(-1), 0.8);
});

test("off, loop-track and restored playback have no fade or timer; cancellation cleans every wake-up", () => {
  for (const kind of ["off", "loop-track", "restore"]) {
    const f = fixture(kind === "off" ? "off" : "fade");
    if (kind === "loop-track") f.state.loop = "track";
    f.state.player.state.status = "playing";
    f.controller.start(f.resource, { fadeIn: true, restoring: kind === "restore" }); f.at(99);
    assert.equal(f.controller.gain, 1); assert.equal(f.timers.size, 0);
  }
  for (const position of [1, 50, 99]) {
    const f = fixture(); f.state.player.state.status = "playing"; f.controller.start(f.resource, { fadeIn: true }); f.at(position);
    assert.equal(f.timers.size, 1); f.controller.cancel();
    assert.equal(f.timers.size, 0); assert.equal(f.controller.resource, null); assert.equal(f.controller.gain, 1);
  }
});
