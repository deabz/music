const { hasAllowedDuration } = require("./music-utils");

function createSpotifyClient(config, request = fetch, now = Date.now) {
  let token = null;
  let expiresAt = 0;
  let tokenPromise = null;
  const timedFetch = (url, options = {}) => request(url, { ...options, signal: AbortSignal.timeout(10000) });
  async function accessToken() {
    if (token && now() < expiresAt) return token;
    if (tokenPromise) return tokenPromise;
    tokenPromise = (async () => {
      if (!config.spotifyClientId || !config.spotifyClientSecret) throw new Error("Spotify credentials are missing.");
      const auth = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString("base64");
      const response = await timedFetch("https://accounts.spotify.com/api/token", {
        method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials"
      });
      if (!response.ok) throw new Error(`Spotify authentication failed (${response.status}).`);
      const data = await response.json();
      if (!data.access_token || !Number.isFinite(data.expires_in)) throw new Error("Invalid Spotify token response.");
      token = data.access_token;
      expiresAt = now() + Math.max(0, data.expires_in - 60) * 1000;
      return token;
    })();
    try { return await tokenPromise; } finally { tokenPromise = null; }
  }
  async function items(url) {
    const match = url.match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
    if (!match) throw new Error("Unsupported Spotify link.");
    const [, type, id] = match;
    const headers = { Authorization: `Bearer ${await accessToken()}` };
    let next = `https://api.spotify.com/v1/${type === "track" ? `tracks/${id}` : `${type}s/${id}/tracks?limit=50`}`;
    const tracks = [];
    while (next) {
      const response = await timedFetch(next, { headers });
      if (!response.ok) throw new Error(`Spotify metadata failed (${response.status}).`);
      const data = await response.json();
      tracks.push(...(type === "track" ? [data] : (data.items || []).map(item => item?.track || item).filter(Boolean)));
      if (tracks.length > config.maxQueueSize) throw new Error("Spotify release exceeds the queue limit.");
      next = type === "track" ? null : data.next;
    }
    return tracks.filter(track => hasAllowedDuration(track.duration_ms / 1000) && Array.isArray(track.artists))
      .map(track => ({ title: track.name, author: track.artists.map(artist => artist.name).join(", "),
        duration: Math.floor(track.duration_ms / 1000), thumbnail: track.album?.images?.[0]?.url,
        search: `${track.name} ${track.artists[0]?.name || ""} audio` }));
  }
  return { items };
}

async function matchSpotifyTracks(tracks, search, artworkFrom, report = console.error) {
  const results = new Array(tracks.length);
  let index = 0;
  async function worker() {
    while (index < tracks.length) {
      const position = index++;
      const track = tracks[position];
      try {
        const matches = await search(track.search, 10);
        const match = matches.find(item => item.url && hasAllowedDuration(item.durationInSec));
        if (match) results[position] = { url: match.url, title: track.title, author: track.author,
          duration: match.durationInSec, thumbnail: track.thumbnail || artworkFrom(match.thumbnails) };
      } catch (error) { report(`[spotify] Could not match track ${position + 1}: ${error.message}`); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, tracks.length) }, worker));
  return results.filter(Boolean);
}
module.exports = { createSpotifyClient, matchSpotifyTracks };
