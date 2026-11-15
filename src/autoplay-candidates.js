const ytdlp = require("youtube-dl-exec");
const { isSongResult, searchYouTube, youtubeCookieOptions, youtubeRuntimeOptions } = require("./music-utils");
const { songIdentity, songKey, hasVersion, blockedSongKeys } = require("./song-identity");
const MIX_CACHE_TTL_MS = 30 * 60 * 1000;
const MIX_ENTRY_LIMIT = 25;
const AUTOPLAY_LOOKUP_TIMEOUT_MS = 45000;
const AUTOPLAY_SCORE_WEIGHTS = { mixMembership: 100, additionalSeed: 80, similarDuration: 15, sameScript: 10, recentArtistPenalty: 30, searchTheme: 35 };

function videoId(track) {
  try {
    const url = new URL(track.url);
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : /^(?:www\.|music\.)?youtube\.com$/.test(url.hostname) ? url.searchParams.get("v") : "";
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch { return null; }
}
function candidateTrack(entry) {
  const id = entry.id;
  let url = entry.webpage_url || entry.url;
  if (!/^https?:\/\//.test(url || "") && /^[\w-]{11}$/.test(id || "")) url = `https://www.youtube.com/watch?v=${id}`;
  return { ...entry, url, title: entry.title, author: entry.author || entry.channel?.name || entry.channel || entry.uploader || entry.creator || "YouTube",
    duration: entry.duration ?? entry.durationInSec, isLive: Boolean(entry.isLive || entry.is_live || (entry.live_status && entry.live_status !== "not_live")),
    thumbnail: entry.thumbnail || entry.thumbnails?.at(-1)?.url, autoSuggested: true };
}
function scriptOf(text) {
  for (const name of ["Hangul", "Hiragana", "Katakana", "Han", "Arabic", "Cyrillic", "Devanagari", "Latin"]) {
    if (new RegExp(`\\p{Script=${name}}`, "u").test(text || "")) return name;
  }
  return null;
}
function recentTracks(state, seed) {
  return [seed, ...(state.history || []).filter(track => songKey(track) !== songKey(seed)).slice(-2).reverse()].filter(Boolean);
}
function rankAutoplayCandidates(entries, state, seed, weights = AUTOPLAY_SCORE_WEIGHTS) {
  const blocked = blockedSongKeys(state, seed);
  const urls = new Set([...(state.autoplayMemory?.urls() || []), ...(state.autoplayTriedUrls || []), seed?.url,
    state.current?.url, ...(state.queue || []).map(track => track.url)]);
  const videos = new Set([...urls].map(url => videoId({ url })).filter(Boolean));
  const recent = recentTracks(state, seed);
  const artists = recent.slice(0, 2).map(track => songIdentity(track).artistKey);
  const durations = recent.map(track => track.duration).filter(Number.isFinite).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
  const script = scriptOf(songIdentity(seed).title);
  const grouped = new Map();
  for (const entry of entries) {
    const track = candidateTrack(entry), identity = songIdentity(track);
    if (!identity.key || blocked.has(identity.key) || urls.has(track.url) || (videoId(track) && videos.has(videoId(track))) || track.duration < 60 || hasVersion(`${track.title} ${track.author}`)
      || !isSongResult({ ...track, channel: { name: track.author }, durationInSec: track.duration })) continue;
    const previous = grouped.get(identity.key);
    const mixSeeds = [...new Set([...(previous?.mixSeeds || []), ...(track.mixSeeds || [])])];
    const candidate = previous || track;
    candidate.mixSeeds = mixSeeds;
    candidate.suggestionScore = mixSeeds.length * weights.mixMembership + Math.max(0, mixSeeds.length - 1) * weights.additionalSeed
      + (Math.abs(track.duration - median) <= 60 ? weights.similarDuration : 0)
      + (script && scriptOf(identity.title) === script ? weights.sameScript : 0)
      - artists.filter(artist => artist && artist === identity.artistKey).length * weights.recentArtistPenalty
      + (track.candidateSource === "search" ? weights.searchTheme : 0);
    grouped.set(identity.key, candidate);
  }
  return [...grouped.values()].sort((a, b) => b.suggestionScore - a.suggestionScore);
}
function buildThemeQueries(seed, history = []) {
  const { title, artist } = songIdentity(seed);
  const hints = [seed.genre, ...(Array.isArray(seed.categories) ? seed.categories : []), ...(Array.isArray(seed.tags) ? seed.tags : [])].filter(value => typeof value === "string").slice(0, 4).join(" ").slice(0, 100);
  const previous = [...new Set(history.slice(-2).map(track => songIdentity(track).artist).filter(Boolean))].join(" ");
  return [...new Set([`${title.slice(0, 120)} ${hints} similar songs`, `${title.slice(0, 80)} ${artist} ${previous} ${hints} songs like this`]
    .map(query => query.replace(/\s+/g, " ").trim()))];
}
async function fetchMix(seedId, signal, run = ytdlp) {
  const result = await run(`https://www.youtube.com/watch?v=${seedId}&list=RD${seedId}`, {
    dumpSingleJson: true, flatPlaylist: true, skipDownload: true, playlistEnd: MIX_ENTRY_LIMIT, noWarnings: true, quiet: true,
    ...youtubeCookieOptions(), ...youtubeRuntimeOptions(), ffmpegLocation: require("ffmpeg-static")
  }, { signal, timeout: 20000, windowsHide: true });
  return (Array.isArray(result.entries) ? result.entries : []).map(candidateTrack);
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error("Autoplay lookup cancelled."), { name: "AbortError" }));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
class AutoplayCandidates {
  constructor(state, { mix = fetchMix, search = searchYouTube, now = Date.now, log = console.error } = {}) {
    Object.assign(this, { state, mix, search, now, log }); this.cache = new Map(); this.chain = Promise.resolve();
  }
  cached(seedId) {
    const entry = this.cache.get(seedId);
    if (entry && this.now() - entry.time < MIX_CACHE_TTL_MS) return entry.items;
    this.cache.delete(seedId); return null;
  }
  list(seed, signal) {
    const pending = this.chain.catch(() => {}).then(async () => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (signal?.aborted) return [];
      signal?.addEventListener("abort", cancel, { once: true });
      this.active = controller;
      const timer = setTimeout(cancel, AUTOPLAY_LOOKUP_TIMEOUT_MS); timer.unref?.();
      try {
        const id = videoId(seed); let entries = [];
        if (id) {
          let items = this.cached(id);
          if (!items) {
            try { items = await abortable(this.mix(id, controller.signal), controller.signal); }
            catch (error) {
              if (controller.signal.aborted) throw error;
              this.log(`[autoplay:${this.state.guild?.id}] Mix unavailable; using theme search.`); items = [];
            }
            this.cache.set(id, { time: this.now(), items });
            while (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value);
          }
          entries.push(...items.map(item => ({ ...item, mixSeeds: [id], candidateSource: "mix" })));
          for (const previous of recentTracks(this.state, seed).slice(1, 3)) {
            const previousId = videoId(previous);
            if (previousId && previousId !== id) entries.push(...(this.cached(previousId) || []).map(item => ({ ...item, mixSeeds: [previousId], candidateSource: "mix" })));
          }
        }
        if (!rankAutoplayCandidates(entries, this.state, seed).length) {
          for (const query of buildThemeQueries(seed, this.state.history)) {
            if (controller.signal.aborted) break;
            try {
              const results = await abortable(this.search(query, 15, undefined, controller.signal), controller.signal);
              entries.push(...results.map(entry => ({ ...candidateTrack(entry), candidateSource: "search" })));
            } catch (error) {
              if (controller.signal.aborted) throw error;
              this.log(`[autoplay:${this.state.guild?.id}] Theme search unavailable.`);
            }
          }
        }
        return controller.signal.aborted ? [] : rankAutoplayCandidates(entries, this.state, seed);
      } finally {
        clearTimeout(timer); signal?.removeEventListener("abort", cancel);
        if (this.active === controller) this.active = null;
      }
    });
    this.chain = pending; return pending;
  }
  cancel() { this.active?.abort(); }
  dispose() { this.cancel(); this.cache.clear(); }
}
module.exports = { AutoplayCandidates, rankAutoplayCandidates, buildThemeQueries, fetchMix, candidateTrack, scriptOf, videoId,
  MIX_CACHE_TTL_MS, MIX_ENTRY_LIMIT, AUTOPLAY_LOOKUP_TIMEOUT_MS, AUTOPLAY_SCORE_WEIGHTS };
