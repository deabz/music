const { ComponentType } = require('discord.js');
const { createLyricsService } = require('./lyrics');
const { buildLyricsModal, LYRICS_MODAL_ID, PANEL_LYRICS_MODAL_ID } = require('./lyrics-input');
const { buildGeniusSearchUrl } = require('./music-utils');
const NO_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };
const escapeLyrics = text => String(text || '').replace(/\\/g, '\\\\').replace(/([`*_{}\[\]()<>~|])/g, '\\$1').replace(/@/g, '@\u200b');
function splitLyrics(text) {
  const pages = []; let page = '', truncated = false;
  for (const line of escapeLyrics(text).split(/\r?\n/)) {
    if (line.length > 3500) { truncated = true; continue; }
    const next = page ? `${page}\n${line}` : line;
    if (next.length > 3500) { pages.push(page); page = line; } else page = next;
    if (pages.length === 10) { truncated = true; page = ''; break; }
  }
  if (page && pages.length < 10) pages.push(page);
  if (!pages.length) pages.push('No displayable lyric lines.');
  if (truncated) pages[pages.length - 1] += '\n\n[Display truncated.]';
  return pages;
}
function lyricsPayload(result, pages, page = 0) {
  const components = pages.length > 1 ? [{ type: 1, components: ['Previous', 'Next'].map((label, index) => ({
    type: 2, style: 2, custom_id: `lyrics:${index ? 'next' : 'previous'}`, label,
    disabled: index ? page === pages.length - 1 : page === 0
  })) }] : [];
  return { content: '', allowedMentions: NO_MENTIONS, components, embeds: [{ color: 0xE6B655,
    title: `Lyrics - ${escapeLyrics(result.artist)} - ${escapeLyrics(result.title)}`.slice(0, 256),
    description: pages[page], footer: { text: `${pages.length > 1 ? `Page ${page + 1}/${pages.length} - ` : ''}Lyrics from LRCLIB` } }] };
}
function createLyricsController({ service = createLyricsService(), now = Date.now, isReady = () => true, log = console.error } = {}) {
  const cooldowns = new Map();
  const privateReply = (interaction, content) => interaction.reply({ content, ephemeral: true, allowedMentions: NO_MENTIONS });
  async function open(interaction, { track, song, panel = false } = {}) {
    try {
      if (!interaction.guild) return await privateReply(interaction, 'Use lyrics inside a server.');
      if (!isReady()) return await privateReply(interaction, 'Lyrics are unavailable while the bot starts or shuts down.');
      if (song === undefined || song === null) {
        if (!track) return await interaction.showModal(buildLyricsModal({ panel }));
      } else {
        song = String(song).trim();
        if (song.length < 2 || song.length > 100) return await privateReply(interaction, 'Enter a song between 2 and 100 characters.');
      }
      const time = now();
      if ((cooldowns.get(interaction.user.id) ?? -Infinity) > time) return await privateReply(interaction, 'Please wait 5 seconds before looking up lyrics again.');
      for (const [id, expires] of cooldowns) if (expires <= time) cooldowns.delete(id);
      cooldowns.set(interaction.user.id, time + 5000);
      await interaction.deferReply({ ephemeral: panel });
      const result = await service.lookup(song ?? track);
      if (!result.found) return await interaction.editReply({ content: `Couldn't find lyrics for ${escapeLyrics(result.title)}. [Search Genius](${buildGeniusSearchUrl(result.title, result.artist)})`, allowedMentions: NO_MENTIONS, components: [], embeds: [] });
      const pages = result.instrumental ? ['This track is instrumental.'] : splitLyrics(result.text);
      const message = await interaction.editReply(lyricsPayload(result, pages));
      if (pages.length < 2 || !message?.createMessageComponentCollector) return;
      let page = 0, chain = Promise.resolve();
      const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 600000,
        filter: button => ['lyrics:previous', 'lyrics:next'].includes(button.customId) });
      collector.on('collect', button => {
        if (button.user.id !== interaction.user.id) { void privateReply(button, 'These pages belong to another user.').catch(() => {}); return; }
        const acknowledged = button.deferUpdate().then(() => true, () => false);
        chain = chain.then(async () => { if (!await acknowledged) return; page = Math.max(0, Math.min(pages.length - 1, page + (button.customId === 'lyrics:next' ? 1 : -1))); await button.editReply(lyricsPayload(result, pages, page)); })
          .catch(() => log('[lyrics] Could not update lyrics pagination.'));
      });
      collector.on('end', () => { chain = chain.then(() => interaction.editReply({ components: [] })).catch(() => log('[lyrics] Could not remove expired page controls.')); });
    } catch {
      // Discord errors can contain the rejected payload: never log them or lyric text.
      log('[lyrics] Lookup or response unavailable.');
      try {
        const payload = { content: 'Lyrics are unavailable right now. Please try again later.', ephemeral: true, allowedMentions: NO_MENTIONS };
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload); else await interaction.reply(payload);
      } catch { /* The interaction may have expired. */ }
    }
  }
  async function handleModal(interaction) {
    if (!interaction.isModalSubmit?.() || ![LYRICS_MODAL_ID, PANEL_LYRICS_MODAL_ID].includes(interaction.customId)) return false;
    await open(interaction, { song: interaction.fields.getTextInputValue('song'), panel: interaction.customId === PANEL_LYRICS_MODAL_ID });
    return true;
  }
  return { open, handleModal };
}
module.exports = { createLyricsController, splitLyrics, escapeLyrics, lyricsPayload, NO_MENTIONS };
