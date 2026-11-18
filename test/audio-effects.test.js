const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const ffmpeg = require("ffmpeg-static");
const { EFFECTS, EFFECT_NAMES, LIMITER, effectChain, effectsRate, describeActive, emptyFilters } = require("../src/audio-effects");
const { commands } = require("../src/commands");

test("effect catalogue has unique names, labels and at least the required effects", () => {
  assert.equal(new Set(EFFECT_NAMES).size, EFFECT_NAMES.length);
  for (const name of ["bassboost", "eightd", "nightcore", "vaporwave", "echo", "treble", "earrape", "karaoke", "reverb", "tremolo",
    "vibrato", "chorus", "flanger", "speedup", "slowdown", "pitchup", "pitchdown", "mono", "lofi"]) assert.ok(EFFECT_NAMES.includes(name), name);
  assert.ok(EFFECTS.every(effect => effect.label && effect.description && effect.filter));
  assert.ok(EFFECT_NAMES.length <= 24, "Slash command choices and select menus allow 25 entries including off/status");
});

test("chains are empty when dry, always end in the limiter, and stack in a stable order", () => {
  assert.deepEqual(effectChain({}), []);
  assert.deepEqual(effectChain(emptyFilters()), []);
  const chain = effectChain({ eightd: true, bassboost: true, nightcore: true });
  assert.equal(chain[0], "aformat=channel_layouts=stereo");
  assert.equal(chain.at(-1), LIMITER);
  assert.ok(chain.indexOf("aresample=48000") < chain.findIndex(part => part.includes("asetrate")));
  assert.ok(chain.findIndex(part => part.includes("bass=")) < chain.findIndex(part => part.includes("apulsator")));
  assert.match(EFFECTS.find(effect => effect.name === "bassboost").filter, /bass=g=1[0-5]/);
  assert.match(EFFECTS.find(effect => effect.name === "eightd").filter, /apulsator=hz=/);
});

test("playback rate multiplies speed effects for position tracking", () => {
  assert.equal(effectsRate({}), 1);
  assert.equal(effectsRate({ nightcore: true }), 1.25);
  assert.equal(effectsRate({ pitchup: true, bassboost: true }), 1);
  assert.equal(effectsRate({ speedup: true, slowdown: true }), 1);
  assert.equal(describeActive({ bassboost: true, eightd: true }), "Bass boost, 8D");
  assert.equal(describeActive({}), "none");
});

test("every effect filter string, and all effects stacked, are accepted by the bundled FFmpeg", () => {
  const sets = [...EFFECT_NAMES.map(name => ({ [name]: true })), Object.fromEntries(EFFECT_NAMES.map(name => [name, true]))];
  for (const filters of sets) {
    const result = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=440:d=0.3",
      "-af", effectChain(filters).join(","), "-f", "null", "-"], { windowsHide: true });
    assert.equal(result.status, 0, `${Object.keys(filters).join("+")}: ${result.stderr}`);
  }
});

test("/effect exposes every effect plus off and status", () => {
  const effect = commands.find(command => command.name === "effect");
  const choices = effect.options[0].choices.map(choice => choice.value);
  for (const name of [...EFFECT_NAMES, "off", "status"]) assert.ok(choices.includes(name), name);
  assert.ok(choices.length <= 25);
});
