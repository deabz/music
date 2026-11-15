const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

const LYRICS_MODAL_ID = "lyrics:modal";
const PANEL_LYRICS_MODAL_ID = "lyrics:modal:panel";

function cleanSongText(value) {
  return String(value || "")
    .replace(/\s*[\[({][^\])}]*\b(?:official|music video|lyrics?|audio|video|visuali[sz]er|hd|hq|4k)\b[^\])}]*[\])}]/gi, " ")
    .replace(/\s*\|\s*(?:GRM\s*Daily|Link\s*Up\s*TV|Mixtape\s*Madness|7clouds)\s*$/i, " ")
    .replace(/\s*(?:[-|]\s*)?\b(?:official(?:\s+(?:music\s+)?(?:video|audio))?|lyrics?(?:\s+video)?|music video|HD|HQ|4K)\s*$/gi, " ")
    .replace(/\s*[-\u2013\u2014]\s*Topic\s*$/i, "")
    .replace(/\s+/g, " ").trim();
}
function mainArtist(value) {
  return cleanSongText(value).replace(/VEVO\s*$/i, "").replace(/\s+Official(?:\s+(?:Music|Channel))?\s*$/i, "")
    .replace(/\s+[\[(]?(?:ft\.?|feat\.?|featuring)\s+.*$/i, "").trim();
}

function parseSongQuery(input) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  const separator = text.indexOf(" - ");
  if (separator >= 0) {
    const artist = mainArtist(text.slice(0, separator));
    const title = cleanSongText(text.slice(separator + 3));
    if (artist && title) return { artist, title, query: `${artist} ${title}`, mode: "artist-title" };
  }
  const query = cleanSongText(text);
  return { artist: "", title: "", query, mode: "search" };
}

function buildLyricsModal({ panel = false } = {}) {
  const input = new TextInputBuilder().setCustomId("song").setLabel("Song")
    .setPlaceholder("Artist - Song title").setStyle(TextInputStyle.Short)
    .setRequired(true).setMinLength(2).setMaxLength(100);
  return new ModalBuilder().setCustomId(panel ? PANEL_LYRICS_MODAL_ID : LYRICS_MODAL_ID)
    .setTitle("Find lyrics").addComponents(new ActionRowBuilder().addComponents(input));
}

module.exports = { cleanSongText, mainArtist, parseSongQuery, buildLyricsModal, LYRICS_MODAL_ID, PANEL_LYRICS_MODAL_ID };
