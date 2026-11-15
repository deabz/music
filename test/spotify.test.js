const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSpotifyClient, matchSpotifyTracks } = require("../src/spotify");
const config = { spotifyClientId: "synthetic", spotifyClientSecret: "synthetic", maxQueueSize: 100 };
const track = { name: "Song", duration_ms: 60000, artists: [{ name: "Artist" }] };
const ok = data => ({ ok: true, json: async () => data });

test("Spotify uses 50-item pages, follows pagination, shares and refreshes cached token", async () => {
  let clock = 0, tokens = 0;
  const urls = [];
  const api = createSpotifyClient(config, async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    urls.push(url);
    if (url.includes("api/token")) { tokens++; return ok({ access_token: "synthetic", expires_in: 3600 }); }
    if (url.endsWith("next")) return ok({ items: [{ track }], next: null });
    return ok({ items: [track], next: "https://api.spotify.com/v1/next" });
  }, () => clock);
  const [album, playlist] = await Promise.all([
    api.items("https://open.spotify.com/album/abc"), api.items("https://open.spotify.com/playlist/def")
  ]);
  assert.equal(album.length, 2); assert.equal(playlist.length, 2);
  assert.equal(tokens, 1);
  assert.ok(urls.includes("https://api.spotify.com/v1/albums/abc/tracks?limit=50"));
  assert.ok(urls.includes("https://api.spotify.com/v1/playlists/def/tracks?limit=50"));
  clock = 3541 * 1000;
  await api.items("https://open.spotify.com/album/abc");
  assert.equal(tokens, 2);
});
test("matching has at most six workers, retains order and skips individual failures", async () => {
  let active = 0, maximum = 0, errors = 0;
  const tracks = Array.from({ length: 20 }, (_, i) => ({ title: String(i), search: String(i) }));
  const results = await matchSpotifyTracks(tracks, async query => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(setImmediate); active--;
    if (query === "3") throw new Error("synthetic search failure");
    return [{ url: query, durationInSec: 60 }];
  }, () => null, () => { errors++; });
  assert.equal(maximum, 6); assert.equal(errors, 1);
  assert.deepEqual(results.map(item => item.title), tracks.filter(item => item.title !== "3").map(item => item.title));
});
test("Spotify timeout/authentication errors propagate and a later request can retry", async () => {
  let fail = true;
  const api = createSpotifyClient(config, async (url, options) => {
    assert.ok(options.signal);
    if (fail) throw new DOMException("synthetic timeout", "TimeoutError");
    return url.includes("api/token") ? ok({ access_token: "synthetic", expires_in: 3600 }) : ok(track);
  });
  await assert.rejects(api.items("https://open.spotify.com/track/abc"), { name: "TimeoutError" });
  fail = false;
  assert.equal((await api.items("https://open.spotify.com/track/abc")).length, 1);
});
