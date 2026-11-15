const { playbackPosition } = require("./playback-position");
const DEFAULT_TRANSITION_SECONDS = 4;
const TRANSITION_TICK_MS = 100;
const NATURAL_HANDOVER_GRACE_MS = 5000;
const clamp = value => Math.max(0, Math.min(1, value));

function parseTransitionSettings(env, warn = console.warn) {
  let mode = env.TRANSITION_MODE ?? "fade";
  if (!["off", "fade", "crossfade"].includes(mode)) {
    warn("[transitions] Invalid TRANSITION_MODE; using fade.");
    mode = "fade";
  }
  if (mode === "crossfade") {
    warn("[transitions] Crossfade is unavailable: PCM mixing and handover need live validation; using fade.");
    mode = "fade";
  }
  const value = Number(env.TRANSITION_SECONDS ?? DEFAULT_TRANSITION_SECONDS);
  const seconds = Number.isFinite(value) && value >= 1 && value <= 12 ? value : DEFAULT_TRANSITION_SECONDS;
  return { mode, seconds };
}

function fadeLengths(duration, fadeOutSeconds, fadeInSeconds) {
  const out = Math.max(0, Number(fadeOutSeconds) || 0);
  const incoming = Math.max(0, Number(fadeInSeconds) || 0);
  const budget = Number.isFinite(duration) && duration > 0 ? duration * 0.4 : 0;
  const scale = out + incoming > 0 ? Math.min(1, budget / (out + incoming)) : 0;
  return { fadeOut: out * scale, fadeIn: incoming * scale };
}

function fadeGain(position, duration, fadeOutSeconds, fadeInSeconds) {
  const { fadeOut, fadeIn } = fadeLengths(duration, fadeOutSeconds, fadeInSeconds);
  const p = Math.max(0, Number(position) || 0);
  const incoming = fadeIn ? Math.sin(clamp(p / fadeIn) * Math.PI / 2) : 1;
  const outgoing = fadeOut ? Math.sin(clamp((duration - p) / fadeOut) * Math.PI / 2) : 1;
  return Math.min(incoming, outgoing);
}

const resourceVolume = (baseVolume, gain, mode = "fade") => baseVolume / 100 * (mode === "off" ? 1 : gain);
function shouldFadeIn({ mode, natural, position = 0, restoring = false, loop = "off", restart = false }) {
  return mode !== "off" && natural && position === 0 && !restoring && loop !== "track" && !restart;
}

// One wake-up outside the window; 100 ms updates only during audible fades.
// Position comes exclusively from delivered audio, never from the wall clock.
class TransitionController {
  constructor(state, settings, { position = playbackPosition, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { state, settings, position, setTimer, clearTimer });
    this.gain = 1;
  }
  start(resource, { fadeIn = false, restoring = false } = {}) {
    this.cancel();
    this.resource = resource;
    this.fadeIn = fadeIn;
    this.restoring = restoring;
    this.refresh(); // Set gain before player.play: no first-sample volume blip.
  }
  cancel() {
    this.clearTimer(this.timer);
    this.timer = null;
    this.resource = null;
    this.gain = 1;
  }
  refresh() {
    this.clearTimer(this.timer);
    this.timer = null;
    const { state, settings, resource } = this;
    if (!resource || resource !== state.resource || !state.current) return;
    const enabled = settings.mode !== "off" && state.loop !== "track" && !this.restoring;
    const half = settings.seconds / 2;
    // Reserve both halves even when this track doesn't need an entrance ramp.
    const lengths = fadeLengths(state.current.duration, half, half);
    const position = this.position(state);
    this.gain = enabled ? fadeGain(position, state.current.duration, lengths.fadeOut, this.fadeIn ? lengths.fadeIn : 0) : 1;
    resource.volume?.setVolume(resourceVolume(state.volume, this.gain, settings.mode));
    if (!enabled || !lengths.fadeOut || state.player?.state?.status !== "playing") return;
    const endStart = state.current.duration - lengths.fadeOut;
    const inWindow = (this.fadeIn && position < lengths.fadeIn) || position >= endStart;
    const delay = inWindow ? TRANSITION_TICK_MS : Math.max(1, (endStart - position) / (state.resourcePlaybackRate || 1) * 1000);
    this.timer = this.setTimer(() => { if (this.resource === resource) this.refresh(); }, delay);
    this.timer?.unref?.();
  }
}

module.exports = { parseTransitionSettings, fadeLengths, fadeGain, resourceVolume, shouldFadeIn,
  TransitionController, TRANSITION_TICK_MS, NATURAL_HANDOVER_GRACE_MS };
