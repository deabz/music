const RECENT_SONG_MEMORY_SIZE = 50;
// Editable: preserved in identity, rejected only for autoplay/suggestions.
const AUTOPLAY_VERSION_KEYWORDS = ["remix", "live", "acoustic", "sped up", "slowed", "reverb", "nightcore", "8d", "cover", "karaoke", "instrumental", "mashup", "1 hour", "mix"];
const normalize = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/['\u2018\u2019]/g, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
function hasVersion(value) {
  const text = ` ${normalize(value)} `;
  return AUTOPLAY_VERSION_KEYWORDS.some(word => text.includes(` ${normalize(word)} `));
}
const credits = value => value.replace(/\s+(?:(?:ft|feat)\.\s*|(?:ft|feat|featuring|with)\s+).*$/i, "");
function cleanTitle(value) {
  return credits(String(value || "").replace(/[\[({]([^\])}]+)[\])}]/g, (whole, content) => {
    if (hasVersion(content)) return ` ${content} `;
    return /\b(?:official|music\s+video|audio|lyrics?|lyric\s+video|visuali[sz]er|hd|hq|4k|explicit|clean)\b/i.test(content) ? " " : ` ${content} `;
  }).replace(/\s*[-\u2013\u2014|]?\s*(?:official(?:\s+music)?\s+video|official\s+audio|lyric\s+video|lyrics?|visuali[sz]er|hd|4k)\s*$/i, "").trim()).trim();
}
function songIdentity(track) {
  const parts = String(track?.title || "").split(/\s+[-\u2013\u2014]\s+/);
  const rawArtist = parts.length > 1 ? parts.shift() : track?.artist || track?.author || track?.channel?.name || "";
  const artist = credits(String(rawArtist).replace(/\s*[-\u2013\u2014]\s*Topic$|VEVO$|\s+Official(?:\s+(?:Music|Channel))?$/i, "").trim());
  const title = cleanTitle(parts.join(" - "));
  const artistKey = normalize(artist).replace(/\s/g, "");
  let titleKey = normalize(title);
  const original = ` ${normalize(track?.title)} `;
  for (const version of AUTOPLAY_VERSION_KEYWORDS) {
    const word = normalize(version);
    if (original.includes(` ${word} `) && !(` ${titleKey} `).includes(` ${word} `)) titleKey += ` ${word}`;
  }
  titleKey = titleKey.trim();
  return { artist, title, titleKey, artistKey, key: titleKey ? `${artistKey}::${titleKey}` : "" };
}
const songKey = track => songIdentity(track).key;
class SongMemory {
  constructor() { this.entries = []; }
  recordStart(track) {
    const instance = track.panelInstanceId || track;
    if (instance === this.lastInstance) return;
    this.lastInstance = instance;
    const identity = songIdentity(track);
    this.entries.push({ key: identity.key, titleKey: identity.titleKey, url: track.url, artist: identity.artistKey });
    this.entries = this.entries.slice(-RECENT_SONG_MEMORY_SIZE);
  }
  keys() { return new Set(this.entries.map(entry => entry.key).filter(Boolean)); }
  urls() { return new Set(this.entries.map(entry => entry.url).filter(Boolean)); }
}
function blockedSongKeys(state, seed = state.current) {
  return new Set([...(state.autoplayMemory?.keys() || []), ...[seed, state.current, ...(state.queue || [])].filter(Boolean).map(songKey)].filter(Boolean));
}
module.exports = { RECENT_SONG_MEMORY_SIZE, AUTOPLAY_VERSION_KEYWORDS, songIdentity, songKey, cleanTitle, hasVersion, SongMemory, blockedSongKeys };
