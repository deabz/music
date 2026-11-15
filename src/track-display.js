// Presentation-only cleanup for public song metadata. Never changes playback state.
function displayTrack(source = {}) {
  const clean = value => String(value || '')
    .replace(/\s*[([\{][^\])}]*\b(?:official|lyric(?:s)?|audio|video|visuali[sz]er|hd|hq|4k)\b[^\])}]*[\])}]/gi, '')
    .replace(/\s*[-–—|]\s*(?:official(?:\s+(?:music\s+)?(?:video|audio))?|lyrics?|audio|video)\s*$/gi, '')
    .replace(/\s*[-–—]\s*Topic\s*$/i, '')
    .replace(/\s*(?:VEVO|\bOfficial(?:\s+(?:Music|Channel))?|\bLyrics)\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
  const rawTitle = String(source.title || 'Unknown track');
  const parts = clean(rawTitle).split(/\s+[-–—]\s+/);
  const explicit = clean(source.artistName || source.albumArtist || source.metadata?.artist);
  const field = clean(source.artist);
  const uploader = String(source.uploader || source.author || source.channel || '').trim();
  const channelLike = /(?:^7clouds$|cloudkid|trap\s*nation|chill\s*nation|[0-9]+clouds|lyrics?|records?|official\s*channel|music\s*channel|uploads?|distribution|monstercat|no\s*copyright|ncs$)/i;
  const knownUploader = uploader && field.toLowerCase() === clean(uploader).toLowerCase();
  const trustedField = field && !knownUploader && !channelLike.test(field) && !channelLike.test(String(source.artist || ''))
    && !/^(?:unknown|unknown artist|various)$/i.test(field) ? field : '';
  let artist = explicit || trustedField;
  let title = clean(rawTitle);
  if (parts.length > 1 && clean(parts[0]) && clean(parts.slice(1).join(' - '))) {
    artist = explicit || trustedField || clean(parts[0]);
    title = clean(parts.slice(1).join(' - '));
  } else if (!artist && field && !knownUploader && !channelLike.test(field) && !channelLike.test(String(source.artist || '')) && !/^(?:unknown|unknown artist|various)$/i.test(field)) {
    artist = field;
  }
  return { title: title || 'Unknown track', artist: artist || '' };
}
module.exports = { displayTrack };
