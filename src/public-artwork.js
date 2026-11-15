const { displayTrack } = require('./track-display');

function safeCoverUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const url = new URL(value);
    const hosts = ['i.ytimg.com', 'img.youtube.com', 'i.scdn.co'];
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) return '';
    // Upgrade tiny YouTube thumbnails without changing video identity or query parameters.
    if (url.hostname !== 'i.scdn.co') url.pathname = url.pathname.replace(/\/(?:default|mqdefault)\.(jpg|webp)$/i, '/hqdefault.$1');
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function publicNowPlaying(snapshot = {}) {
  const online = snapshot.ready === true;
  const track = online && snapshot.track;
  const finite = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return {
    status: online ? 'online' : 'offline',
    track: track ? {
      ...displayTrack(track),
      thumbnail: [track.thumbnail, track.artwork, track.coverUrl].map(safeCoverUrl).find(Boolean) || null,
      durationSeconds: finite(track.durationSeconds),
      positionSeconds: finite(track.positionSeconds),
      status: ['playing', 'paused', 'buffering'].includes(track.status) ? track.status : 'buffering',
      playbackRate: Math.min(4, Math.max(.25, finite(track.playbackRate) || 1))
    } : null
  };
}
module.exports = { safeCoverUrl, publicNowPlaying };
