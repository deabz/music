const MAX_TRACK_DURATION_SECONDS = 30 * 60;
const MAX_SUGGESTED_TRACK_DURATION_SECONDS = 6 * 60;
const ytdlp = require("youtube-dl-exec");

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

const NON_SONG_TITLE_PATTERN = /\b(?:live(?:\s*stream)?|concert|top\s*\d+|best\s+(?:of|songs?(?:\s+(?:of|from|in)\s+\d{4})?)|greatest\s+hits|playlist|compilation|collection|medley|full\s+album|non[\s-]?stop|mix(?:tape)?|karaoke|reaction|interview|podcast)\b/i;

const isSongResult = result =>
  Boolean(result.url && result.title) &&
  !result.isLive &&
  !NON_SONG_TITLE_PATTERN.test(result.title) &&
  Number.isFinite(result.durationInSec) &&
  result.durationInSec > 0 &&
  result.durationInSec <= MAX_SUGGESTED_TRACK_DURATION_SECONDS;

async function searchYouTube(query, limit = 10, runYtdlp = ytdlp) {
  const resultCount = Math.max(1, Math.min(20, Math.floor(limit) || 10));
  const result = await runYtdlp(`ytsearch${resultCount}:${query}`, {
    dumpSingleJson: true,
    flatPlaylist: true,
    skipDownload: true,
    noWarnings: true,
    quiet: true,
    ffmpegLocation: require('ffmpeg-static')
  });
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

async function resolveSuggestedTrack(track, triedUrls, search, artworkFrom) {
  const artist = track.author.split(",")[0].trim();
  if (!artist) return null;
  const endedTitle = normalizeTitle(track.title, artist);
  const candidates = new Map();
  const errors = [];

  for (const query of [`${artist} similar songs`, `${artist} popular songs`]) {
    try {
      const results = await search(query, { limit: 15, source: { youtube: "video" } });
      for (const result of results) {
        const normalized = normalizeTitle(result.title || "", result.channel?.name || "");
        if (!isSongResult(result) || result.url === track.url) continue;
        if (!normalized || normalized === endedTitle || normalized.includes(endedTitle) || endedTitle.includes(normalized)) continue;
        if (!candidates.has(result.url)) {
          candidates.set(result.url, {
            url: result.url,
            title: result.title,
            author: result.channel?.name || artist,
            duration: result.durationInSec,
            thumbnail: artworkFrom(result.thumbnails),
            autoSuggested: true
          });
        }
      }
    } catch (error) {
      errors.push(error);
      console.error(`[autoplay] Search failed for "${query}": ${error.message}`);
    }
  }

  const suggestion = [...candidates.values()].find(candidate => !triedUrls.has(candidate.url));
  if (suggestion) return suggestion;
  if (!candidates.size && errors.length === 2) {
    throw new Error(`Could not search for a suggested song: ${errors.map(error => error.message).join("; ")}`);
  }
  if (candidates.size) {
    console.log(`[autoplay] Tried all ${candidates.size} short suggestions for ${track.title}.`);
  }
  return null;
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

module.exports = { MAX_TRACK_DURATION_SECONDS, formatYtdlpTime, hasAllowedDuration, isSongResult, resolveSuggestedTrack, searchYouTube, buildGeniusSearchUrl, resolvePlaylist };
