const MAX_TRACK_DURATION_SECONDS = 30 * 60;
const MAX_SUGGESTED_TRACK_DURATION_SECONDS = 6 * 60;
const ytdlp = require("youtube-dl-exec");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
let writableYouTubeCookiesFile = null;

// Node is already installed on every bot host; yt-dlp does not enable it by default.
const youtubeRuntimeOptions = () => ({
  jsRuntimes: `node:${process.execPath}`,
  remoteComponents: "ejs:github"
});

const youtubeCookieOptions = (file = writableYouTubeCookiesFile || process.env.YOUTUBE_COOKIES_FILE) =>
  typeof file === "string" && file.trim() ? { cookies: file.trim() } : {};

async function prepareYouTubeCookies(file = process.env.YOUTUBE_COOKIES_FILE) {
  if (typeof file !== "string" || !file.trim()) return;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nyx-cookies-"));
  const destination = path.join(directory, "cookies.txt");
  try {
    await fs.chmod(directory, 0o700);
    await fs.copyFile(file.trim(), destination);
    await fs.chmod(destination, 0o600);
  } catch (error) {
    await fs.unlink(destination).catch(() => {});
    await fs.rmdir(directory).catch(() => {});
    throw error;
  }
  writableYouTubeCookiesFile = destination;
  return destination;
}

const hasAllowedDuration = duration =>
  Number.isFinite(duration) && duration > 0 && duration <= MAX_TRACK_DURATION_SECONDS;

const formatYtdlpTime = seconds => {
  const totalMilliseconds = Math.floor(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor(totalMilliseconds / 60_000) % 60;
  const remainingSeconds = Math.floor(totalMilliseconds / 1000) % 60;
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
};

const normalizeTitle = (title, artistName) => {
  const prefix = `${artistName} - `;
  const withoutArtist = title.toLowerCase().startsWith(prefix.toLowerCase())
    ? title.slice(prefix.length)
    : title;
  return withoutArtist
    .replace(/\s*[\[(]?\s*(?:ft|feat|featuring)\b[\s\S]*$/i, "")
    .replace(/\s*\([^)]*\)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

// Editable autoplay rejection rules, applied to BOTH titles and channel names.
const AUTOPLAY_REJECT_KEYWORDS = [
  /\b(?:kids?|children|nursery|baby shark|cocomelon|danny go)\b/i,
  /\b(?:live(?:\s*stream)?|concert|top\s*\d+|best\s+(?:of|songs?(?:\s+(?:of|from|in)\s+\d{4})?))\b/i,
  /\b(?:greatest\s+hits|playlist|compilation|collection|medley|full\s+album|non[\s-]?stop|mix(?:tape)?)\b/i,
  /\b(?:karaoke|reaction|interview|podcast|one\s+hour|\d+\s*(?:hours?|hrs?|minutes?))\b/i
];
const isSongResult = result =>
  Boolean(result.url && result.title) && !result.isLive &&
  !AUTOPLAY_REJECT_KEYWORDS.some(rule => rule.test(`${result.title} ${result.channel?.name || ""}`)) &&
  Number.isFinite(result.durationInSec) && result.durationInSec > 0 &&
  result.durationInSec <= MAX_SUGGESTED_TRACK_DURATION_SECONDS;

const artistKey = value => String(value || "").replace(/\s*[-\u2013\u2014]\s*Topic$|VEVO$|\s+Official(?:\s+Channel)?$/i, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function suggestionScore(result, artist, sourceChannel) {
  const channel = artistKey(result.channel?.name);
  const name = artistKey(artist);
  if (!name) return 0;
  const artistInTitle = (` ${artistKey(result.title)} `).includes(` ${name} `);
  return (channel === name ? 100 : 0) + (artistInTitle ? 60 : 0)
    + (channel && channel === artistKey(sourceChannel) ? 40 : 0);
}

async function searchYouTube(query, limit = 10, runYtdlp = ytdlp, signal = undefined) {
  const resultCount = Math.max(1, Math.min(20, Math.floor(limit) || 10));
  const result = await runYtdlp(`ytsearch${resultCount}:${query}`, {
    dumpSingleJson: true,
    flatPlaylist: true,
    skipDownload: true,
    noWarnings: true,
    quiet: true,
    ...youtubeCookieOptions(),
    ...youtubeRuntimeOptions(),
    ffmpegLocation: require('ffmpeg-static')
  }, { signal, timeout: 10000, windowsHide: true });
  const entries = Array.isArray(result.entries) ? result.entries : [];
  return entries.map(entry => ({
    url: entry.webpage_url || entry.original_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null),
    title: entry.title,
    channel: { name: entry.channel || entry.uploader || entry.creator || "YouTube" },
    durationInSec: Number.isFinite(entry.duration) ? entry.duration : null,
    isLive: entry.is_live === true || (entry.live_status != null && entry.live_status !== "not_live"),
    thumbnails: Array.isArray(entry.thumbnails)
      ? entry.thumbnails
      : entry.thumbnail
        ? [{ url: entry.thumbnail }]
        : []
  })).filter(entry => entry.url && entry.title);
}

async function resolveSuggestedTracks(track, triedUrls, search, artworkFrom) {
  const titleArtist = String(track.title || "").split(/\s+[-\u2013\u2014]\s+/);
  const artist = (titleArtist.length > 1 ? titleArtist[0] : String(track.author || "").split(",")[0])
    .replace(/\s*[-\u2013\u2014]\s*Topic$|VEVO$|\s+Official(?:\s+Channel)?$/i, "").trim();
  if (!artist) return [];
  const endedTitle = normalizeTitle(track.title, artist);
  const candidates = new Map();
  const errors = [];

  for (const query of [`${artist} official audio`, `${artist} songs`]) {
    try {
      const results = await search(query, { limit: 15, source: { youtube: "video" } });
      for (const result of results) {
        const normalized = normalizeTitle(result.title || "", artist);
        const score = suggestionScore(result, artist, track.author);
        if (!isSongResult(result) || result.url === track.url || score === 0) continue;
        if (!normalized || normalized === endedTitle || normalized.includes(endedTitle) || endedTitle.includes(normalized)) continue;
        if (!candidates.has(result.url)) {
          candidates.set(result.url, {
            url: result.url,
            title: result.title,
            author: result.channel?.name || artist,
            duration: result.durationInSec,
            thumbnail: artworkFrom(result.thumbnails),
            autoSuggested: true,
            suggestionScore: score
          });
        }
      }
    } catch (error) {
      if (error.name === "AbortError") throw error;
      errors.push(error);
      console.error(`[autoplay] Search failed for "${query}": ${error.message}`);
    }
  }

  const suggestions = [...candidates.values()].sort((a, b) => b.suggestionScore - a.suggestionScore)
    .filter(candidate => !triedUrls.has(candidate.url)).slice(0, 10);
  if (!suggestions.length && !candidates.size && errors.length === 2) {
    throw new Error(`Could not search for suggested songs: ${errors.map(error => error.message).join("; ")}`);
  }
  return suggestions;
}

async function resolveSuggestedTrack(...args) {
  return (await resolveSuggestedTracks(...args))[0] || null;
}

function buildGeniusSearchUrl(title, artist) {
  const clean = value => typeof value === "string"
    ? value
      .replace(/\s*[\[(](?:official\s+)?(?:music\s+)?video[\])]/gi, " ")
      .replace(/\s*[\[(]lyrics?[\])]/gi, " ")
      .trim()
    : "";
  const query = [clean(artist), clean(title)].filter(Boolean).join(" ");
  return `https://genius.com/search?q=${encodeURIComponent(query)}`;
}

async function resolvePlaylist(url, runYtdlp = ytdlp) {
  const result = await runYtdlp(url, {
    dumpSingleJson: true,
    flatPlaylist: true,
    noWarnings: true,
    quiet: true,
    ...youtubeCookieOptions(),
    ...youtubeRuntimeOptions(),
    ffmpegLocation: require('ffmpeg-static')
  });
  const entries = Array.isArray(result.entries) ? result.entries : [];
  return entries.map(entry => ({
    url: entry.webpage_url || entry.original_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null),
    title: entry.title,
    author: entry.channel || entry.uploader || entry.creator || "YouTube",
    duration: Number.isFinite(entry.duration) ? entry.duration : null,
    thumbnail: Array.isArray(entry.thumbnails)
      ? entry.thumbnails[0]?.url
      : entry.thumbnail
  })).filter(entry => entry.url && entry.title && hasAllowedDuration(entry.duration));
}

module.exports = { AUTOPLAY_REJECT_KEYWORDS, suggestionScore, MAX_TRACK_DURATION_SECONDS, formatYtdlpTime, hasAllowedDuration, isSongResult, resolveSuggestedTrack, resolveSuggestedTracks, searchYouTube, buildGeniusSearchUrl, resolvePlaylist, youtubeCookieOptions, youtubeRuntimeOptions, prepareYouTubeCookies };
