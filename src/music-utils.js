const MAX_TRACK_DURATION_SECONDS = 30 * 60;
const MAX_SUGGESTED_TRACK_DURATION_SECONDS = 6 * 60;
const ytdlp = require("youtube-dl-exec");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { hasVersion } = require("./song-identity");
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

// Editable autoplay rejection rules, applied to BOTH titles and channel names.
const AUTOPLAY_REJECT_KEYWORDS = [
  /\b(?:kids?|children|nursery|baby shark|cocomelon|danny go)\b/i,
  /\b(?:live(?:\s*stream)?|concert|top\s*\d+|best\s+(?:of|songs?(?:\s+(?:of|from|in)\s+\d{4})?))\b/i,
  /\b(?:greatest\s+hits|playlist|compilation|collection|medley|full\s+album|non[\s-]?stop|mix(?:tape)?)\b/i,
  /\b(?:karaoke|reaction|interview|podcast|one\s+hour|\d+\s*(?:hours?|hrs?|minutes?))\b/i
];
const isSongResult = result =>
  Boolean(result.url && result.title) && !result.isLive &&
  !hasVersion(`${result.title} ${result.channel?.name || ""}`) &&
  !AUTOPLAY_REJECT_KEYWORDS.some(rule => rule.test(`${result.title} ${result.channel?.name || ""}`)) &&
  Number.isFinite(result.durationInSec) && result.durationInSec >= 60 &&
  result.durationInSec <= MAX_SUGGESTED_TRACK_DURATION_SECONDS;

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
    tags: Array.isArray(entry.tags) ? entry.tags : [], categories: Array.isArray(entry.categories) ? entry.categories : [], genre: entry.genre,
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

async function resolveSuggestedTracks(track, triedUrls, search, artworkFrom, suppliedState) {
  const { AutoplayCandidates } = require("./autoplay-candidates");
  const state = suppliedState || { current: track, queue: [], autoplayTriedUrls: triedUrls };
  const provider = new AutoplayCandidates(state, { mix: async () => [],
    search: (query, limit, unused, signal) => search(query, { limit, signal }) });
  try {
    return (await provider.list(track, state.suggestionAbort?.signal)).map(item => ({ ...item,
      thumbnail: artworkFrom?.(item.thumbnails) || item.thumbnail }));
  } finally { provider.dispose(); }
}
async function resolveSuggestedTrack(...args) {
  const items = await resolveSuggestedTracks(...args);
  const [track, triedUrls, , , state] = args;
  return require("./autoplay-candidates").chooseAutoplayCandidate(items,
    state || { current: track, queue: [], autoplayTriedUrls: triedUrls }, track);
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

module.exports = { AUTOPLAY_REJECT_KEYWORDS, MAX_TRACK_DURATION_SECONDS, formatYtdlpTime, hasAllowedDuration, isSongResult, resolveSuggestedTrack, resolveSuggestedTracks, searchYouTube, buildGeniusSearchUrl, resolvePlaylist, youtubeCookieOptions, youtubeRuntimeOptions, prepareYouTubeCookies };
