// Audio resource duration advances with delivered audio and freezes while paused.
function playbackPosition(state) {
  if (!state?.current) return 0;
  const rate = state.resourcePlaybackRate || 1;
  const position = Math.max(0, (state.resumeOffsetSeconds || 0)
    + (state.resource?.playbackDuration || 0) / 1000 * rate);
  return state.current.duration > 0 ? Math.min(state.current.duration, position) : position;
}
module.exports = { playbackPosition };
