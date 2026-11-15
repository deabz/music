const { displayTrack } = require("./track-display");
const { cleanSongText, mainArtist, parseSongQuery } = require("./lyrics-input");

const LYRICS_CACHE_LIMIT = 100;
const NEGATIVE_CACHE_MS = 10 * 60 * 1000;
const normalized = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function prepareLyricsInput(input) {
  if (typeof input === "string") return { ...parseSongQuery(input), duration: null };
  const title = cleanSongText(input?.title);
  const author = mainArtist(input?.author);
  const display = displayTrack({ title, artist: author, uploader: input?.author });
  const artist = mainArtist(display.artist || author);
  const song = cleanSongText(display.title).replace(/\s+[\[(]?(?:ft\.?|feat\.?|featuring)\s+.*$/i, "").trim();
  return { artist, title: song, query: [artist, song].filter(Boolean).join(" "), mode: "track",
    duration: Number.isFinite(input?.duration) && input.duration > 0 ? input.duration : null,
    album: cleanSongText(input?.albumName || input?.album) };
}
function similarity(left, right) {
  const a = normalized(left), b = normalized(right);
  if (!a || !b) return 0;
  if (a === b || a.replace(/ /g, "") === b.replace(/ /g, "")) return 1;
  const first = new Set(a.split(" ")), second = new Set(b.split(" "));
  return 2 * [...first].filter(word => second.has(word)).length / (first.size + second.size);
}
function lyricsText(record) {
  if (typeof record.plainLyrics === "string" && record.plainLyrics.trim()) return record.plainLyrics.trim();
  if (typeof record.syncedLyrics !== "string") return "";
  return record.syncedLyrics.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, "")
    .replace(/^\[(?:ar|ti|al|by|offset|length):[^\]]*\]\s*$/gmi, "").trim();
}
function bestLyricsMatch(records, input) {
  let best = null, bestScore = -1;
  for (const record of records) {
    if (!record || typeof record.trackName !== "string" || typeof record.artistName !== "string") continue;
    if (!record.instrumental && !lyricsText(record)) continue;
    const title = cleanSongText(record.trackName);
    const titleScore = input.mode === "search"
      ? Math.max(similarity(input.query, title), similarity(input.query, `${record.artistName} ${title}`))
      : similarity(input.title, title);
    if (titleScore < 0.8) continue;
    const artistScore = input.artist ? similarity(input.artist, mainArtist(record.artistName)) : 0;
    if (input.artist && artistScore < 0.8) continue;
    const difference = input.duration && Number.isFinite(record.duration) ? Math.abs(input.duration - record.duration) : null;
    if (difference !== null && difference > Math.max(30, input.duration * 0.25)) continue;
    const score = titleScore * 10 + artistScore * 2 + (difference === null ? 0 : difference <= 5 ? 2 - difference / 20 : difference <= 15 ? 0.5 : 0);
    if (score > bestScore) { best = record; bestScore = score; }
  }
  return best;
}
function missing(input) {
  return { found: false, title: input.title || input.query, artist: input.artist || "", text: "", instrumental: false, source: "LRCLIB" };
}
function matched(record) {
  return { found: true, title: record.trackName, artist: record.artistName,
    text: record.instrumental ? "" : lyricsText(record), instrumental: record.instrumental === true, source: "LRCLIB" };
}

function createLyricsService({ request = globalThis.fetch, now = Date.now, timeoutMs = 8000 } = {}) {
  const cache = new Map(), inFlight = new Map();
  async function get(endpoint, parameters) {
    const url = new URL(endpoint, "https://lrclib.net");
    for (const [name, value] of Object.entries(parameters)) if (value !== null && value !== undefined && value !== "") url.searchParams.set(name, String(value));
    const controller = new AbortController(); let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Lyrics request timed out")); }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await request(url.href, { signal: controller.signal, headers: { "User-Agent": "LunaBot-Discord-Music-Bot (personal use)" } });
        if (response.status === 404) return { status: 404 };
        if (!response.ok) return { failed: true };
        return { status: response.status, data: await response.json() };
      })()]);
    } catch { return { failed: true }; }
    finally { clearTimeout(timer); }
  }
  async function resolve(input) {
    const absent = missing(input);
    if (input.query.length < 2) return { result: absent, cacheable: false };
    if (input.artist && input.title) {
      const exact = await get("/api/get", { artist_name: input.artist, track_name: input.title, album_name: input.album, duration: input.duration });
      if (exact.failed) return { result: absent, cacheable: false };
      if (exact.status !== 404) {
        if (!exact.data || typeof exact.data !== "object" || Array.isArray(exact.data)) return { result: absent, cacheable: false };
        const record = bestLyricsMatch([exact.data], input);
        if (record) return { result: matched(record), cacheable: true };
      }
    }
    const queries = [input.query];
    if (input.mode === "track" && input.title && normalized(input.query) !== normalized(input.title)) queries.push(input.title);
    for (const query of queries) {
      const search = await get("/api/search", { q: query });
      if (search.failed) return { result: absent, cacheable: false };
      if (search.status === 404) continue;
      if (!Array.isArray(search.data)) return { result: absent, cacheable: false };
      const record = bestLyricsMatch(search.data, input);
      if (record) return { result: matched(record), cacheable: true };
    }
    return { result: absent, cacheable: true };
  }
  async function lookup(source) {
    try {
      const input = prepareLyricsInput(source);
      const key = `${normalized(input.artist)}|${normalized(input.title || input.query)}`;
      const saved = cache.get(key);
      if (saved && saved.expires > now()) { cache.delete(key); cache.set(key, saved); return { ...saved.result }; }
      cache.delete(key);
      if (inFlight.has(key)) return { ...await inFlight.get(key) };
      const pending = (async () => {
        const { result, cacheable } = await resolve(input);
        if (cacheable) {
          cache.set(key, { result, expires: result.found ? Infinity : now() + NEGATIVE_CACHE_MS });
          while (cache.size > LYRICS_CACHE_LIMIT) cache.delete(cache.keys().next().value);
        }
        return result;
      })();
      inFlight.set(key, pending);
      try { return { ...await pending }; } finally { inFlight.delete(key); }
    } catch { return { found: false, title: "that song", artist: "", text: "", instrumental: false, source: "LRCLIB" }; }
  }
  return { lookup };
}
module.exports = { createLyricsService, prepareLyricsInput, bestLyricsMatch, lyricsText, LYRICS_CACHE_LIMIT, NEGATIVE_CACHE_MS };
