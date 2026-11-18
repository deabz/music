// Audio effect catalogue. Every effect is a plain FFmpeg -af fragment, so any
// combination can be stacked into one filter chain on the existing pipeline.
//
// All rate/pitch effects assume 48 kHz input; the chain resamples to 48 kHz
// before them, so asetrate ratios are exact regardless of the source format.
// `rate` is the source-seconds-per-output-second factor used for position math.
const SAMPLE_RATE = 48000;
const semitone = steps => 2 ** (steps / 12);
const PITCH_UP = semitone(3);
const PITCH_DOWN = semitone(-3);
const fixed = value => Number(value.toFixed(4));
const resampleTo = ratio => `asetrate=${SAMPLE_RATE}*${fixed(ratio)},aresample=${SAMPLE_RATE}`;

// Order matters: speed/pitch first, then tone shaping, then modulation and
// space, with 8D last so it rotates the fully processed signal.
const EFFECTS = [
  // Speed and pitch.
  { name: "nightcore", label: "Nightcore", description: "Faster and higher pitched", stage: "rate",
    filter: resampleTo(1.25), rate: 1.25 },
  { name: "vaporwave", label: "Vaporwave", description: "Slowed, lower pitch with a soft room", stage: "rate",
    filter: `${resampleTo(0.8)},aecho=0.8:0.7:70:0.25`, rate: 0.8 },
  { name: "speedup", label: "Speed up", description: "1.25x tempo, same pitch", stage: "rate",
    filter: "atempo=1.25", rate: 1.25 },
  { name: "slowdown", label: "Slow down", description: "0.8x tempo, same pitch", stage: "rate",
    filter: "atempo=0.8", rate: 0.8 },
  { name: "pitchup", label: "Pitch up", description: "Up 3 semitones, same tempo", stage: "rate",
    filter: `${resampleTo(PITCH_UP)},atempo=${fixed(1 / PITCH_UP)}`, rate: 1 },
  { name: "pitchdown", label: "Pitch down", description: "Down 3 semitones, same tempo", stage: "rate",
    filter: `${resampleTo(PITCH_DOWN)},atempo=${fixed(1 / PITCH_DOWN)}`, rate: 1 },
  // Tone.
  // Low shelf (+14 dB under ~110 Hz) plus a +5 dB peak at 50 Hz for sub punch.
  // The -7 dB pre-gain keeps headroom; the final limiter catches any peaks.
  { name: "bassboost", label: "Bass boost", description: "Heavy +14 dB low end (40-120 Hz)", stage: "tone",
    filter: "volume=-7dB,bass=g=14:f=110:w=0.6,equalizer=f=50:t=q:w=1.2:g=5" },
  { name: "treble", label: "Treble boost", description: "+10 dB brighter highs", stage: "tone",
    filter: "volume=-5dB,treble=g=10:f=3500:w=0.6" },
  // Vocals are usually mixed to the centre: cut the mid (L+R) channel, then
  // restore some low end that the cut also removes.
  { name: "karaoke", label: "Karaoke", description: "Reduces centred vocals", stage: "tone",
    filter: "stereotools=mlev=0.015625,bass=g=6:f=150" },
  { name: "mono", label: "Mono", description: "Both ears hear the same mix", stage: "tone",
    filter: "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1" },
  { name: "lofi", label: "Lofi", description: "Soft, muffled, slightly crunchy", stage: "tone",
    filter: "highpass=f=100,lowpass=f=2500,acrusher=bits=12:mode=log:aa=1:mix=0.3,volume=-2dB" },
  { name: "earrape", label: "Earrape", description: "Extremely loud and distorted", stage: "tone",
    filter: "bass=g=10,volume=20dB,asoftclip=type=hard", warning: "Earrape is extremely loud. Turn your volume down first." },
  // Modulation.
  { name: "tremolo", label: "Tremolo", description: "Pulsing volume", stage: "mod",
    filter: "tremolo=f=6:d=0.7" },
  { name: "vibrato", label: "Vibrato", description: "Wobbling pitch", stage: "mod",
    filter: "vibrato=f=6:d=0.5" },
  { name: "chorus", label: "Chorus", description: "Thick, doubled voices", stage: "mod",
    filter: "chorus=0.6:0.9:50|60|40:0.4|0.32|0.3:0.25|0.4|0.3:2|2.3|1.3" },
  { name: "flanger", label: "Flanger", description: "Sweeping jet-plane whoosh", stage: "mod",
    filter: "flanger=delay=2:depth=6:regen=40:speed=0.5:width=80" },
  // Space.
  { name: "echo", label: "Echo", description: "Distinct repeating echoes", stage: "space",
    filter: "aecho=0.8:0.85:250|500:0.35|0.2" },
  { name: "reverb", label: "Reverb", description: "Big room ambience", stage: "space",
    filter: "aecho=0.8:0.9:40|67|95|130|180:0.4|0.34|0.28|0.22|0.16" },
  // Collapse to mono first so the rotation is obvious, then sweep the sound
  // around the head every 8 seconds (L and R are 180 degrees out of phase).
  { name: "eightd", label: "8D", description: "Sound rotates around your head", stage: "space",
    filter: "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,apulsator=hz=0.125:amount=0.85:offset_l=0:offset_r=0.5" }
];
const EFFECT_NAMES = EFFECTS.map(effect => effect.name);
const EFFECT_BY_NAME = new Map(EFFECTS.map(effect => [effect.name, effect]));
// Final safety stage: a brickwall limiter just under 0 dBFS. Auto-level is off
// so quiet effects are not pumped up.
const LIMITER = "alimiter=limit=0.9:attack=5:release=50:level=0";

const activeEffects = filters => EFFECTS.filter(effect => filters?.[effect.name]);
const effectsRate = filters => activeEffects(filters).reduce((rate, effect) => rate * (effect.rate || 1), 1);
function effectChain(filters) {
  const active = activeEffects(filters);
  if (!active.length) return [];
  // Several effects (8D, karaoke, mono) need two channels; force stereo input.
  const chain = ["aformat=channel_layouts=stereo"];
  if (active.some(effect => effect.stage === "rate")) chain.push(`aresample=${SAMPLE_RATE}`);
  for (const effect of active) chain.push(effect.filter);
  chain.push(LIMITER);
  return chain;
}
const emptyFilters = () => Object.fromEntries(EFFECT_NAMES.map(name => [name, false]));
const effectLabels = filters => activeEffects(filters).map(effect => effect.label);
const describeActive = filters => effectLabels(filters).join(", ") || "none";

module.exports = { EFFECTS, EFFECT_NAMES, EFFECT_BY_NAME, LIMITER, activeEffects, effectsRate, effectChain,
  emptyFilters, effectLabels, describeActive };
