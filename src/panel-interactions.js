const { musicAccessError } = require("./music-permissions");
const { playbackPosition } = require("./playback-position");
const { PANEL_PREFIX, buildEffectsMenu, buildFavouritesMenu } = require("./player-panel");

const ACTION_PERMISSIONS = {
  play: "resume", previous: "forward", pause: "pause", next: "skip", loop: "loop",
  "vol-down": "voldown", rewind: "forward", favourite: "volume", forward: "forward", "vol-up": "volup",
  "favourites-select": "volume", "effects-apply": "echo", lyrics: "forward", shuffle: "shuffle", stop: "stop", effects: "echo", favourites: "volume", suggest: "volume"
};
const privateReply = (interaction, content) => interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
function createPanelInteractionHandler({ getMusic, isReady = () => true, favourites, lyrics, log = console.error } = {}) {
  const skipping = new WeakSet();
  const handle = async interaction => {
    if (!interaction.customId?.startsWith(PANEL_PREFIX) || !(interaction.isButton?.() || interaction.isStringSelectMenu?.())) return false;
    if (!interaction.guild || !isReady()) {
      await privateReply(interaction, "The player is unavailable while the bot initializes or shuts down.");
      return true;
    }
    const [action, ownerId] = interaction.customId.slice(PANEL_PREFIX.length).split(":");
    const temporary = ["effects-apply", "favourites-select"].includes(action);
    if (temporary && ownerId !== interaction.user.id) {
      await privateReply(interaction, "This menu belongs to another listener."); return true;
    }
    const permission = ACTION_PERMISSIONS[action];
    if (!permission) { await privateReply(interaction, "This player control is unavailable."); return true; }
    const state = getMusic(interaction.guild);
    const denied = action === "lyrics" ? null : musicAccessError(interaction, state, permission);
    if (denied) { await privateReply(interaction, denied); return true; }
    if (!temporary && state.panelMessageId && interaction.message?.id !== state.panelMessageId) {
      await privateReply(interaction, "This is an old panel. Use /nowplaying to bring back the current player.");
      return true;
    }
    if (action === "next" && skipping.has(state)) {
      await privateReply(interaction, "A skip is already in progress."); return true;
    }
    if (action === "next") skipping.add(state);
    try {
    state.panel?.wake();
    if (action === "effects") {
      await interaction.reply({ content: "Choose exactly the effects you want enabled.", ephemeral: true,
        components: buildEffectsMenu(state, interaction.user.id) });
      return true;
    }
    if (action === "lyrics") {
      await lyrics.open(interaction, { track: state.current, panel: true });
      return true;
    }
    await interaction.deferUpdate();
    try {
      if (action === "favourite") {
        if (!state.current) throw new Error("Nothing is playing.");
        const result = await favourites.toggle(interaction.user.id, state.current);
        await interaction.followUp({ content: result === "limit" ? "You can save up to 25 favourites. Remove one first."
          : result === "added" ? "Saved to your favourites." : "Removed from your favourites.", ephemeral: true });
      } else if (action === "favourites") {
        const tracks = favourites.list(interaction.user.id);
        await interaction.followUp({ content: tracks.length ? "Choose one of your saved songs." : "You have no favourites yet.",
          ephemeral: true, ...(tracks.length ? { components: buildFavouritesMenu(tracks, interaction.user.id) } : {}) });
      } else if (action === "favourites-select") {
        const track = favourites.list(interaction.user.id).find(item => item.id === interaction.values?.[0]);
        if (!track) {
          await interaction.followUp({ content: "That favourite is no longer available.", ephemeral: true }); return true;
        }
        const channelId = state.connection?.joinConfig.channelId || interaction.member?.voice?.channelId;
        const voiceChannel = await interaction.guild.channels.fetch(channelId);
        const { id, ...song } = track;
        await state.add([{ ...song, autoSuggested: false }], voiceChannel, interaction.user.id, interaction.channel);
        await interaction.editReply({ content: `Added ${song.title.slice(0, 100)}.`, components: [], allowedMentions: { parse: [] } });
      } else if (action === "suggest") {
        const selected = state.suggestions?.take(interaction.values?.[0]);
        if (!selected) {
          await interaction.followUp({ content: "That suggestion is no longer available.", ephemeral: true });
          return true;
        }
        try {
          const channelId = state.connection?.joinConfig.channelId || interaction.member?.voice?.channelId;
          const voiceChannel = await interaction.guild.channels.fetch(channelId);
          const { id, ...track } = selected;
          await state.add([{ ...track, autoSuggested: false }], voiceChannel, interaction.user.id, interaction.channel);
          await interaction.followUp({ content: `Added ${selected.title.slice(0, 100)}.`, ephemeral: true, allowedMentions: { parse: [] } });
        } catch (error) { state.suggestions.restore(selected); throw error; }
      } else if (action === "effects-apply") {
        await state.setAudioFilters(interaction.values);
        await interaction.editReply({ content: "Audio effects updated.", components: [] });
      } else if (action === "play") {
        if (!await state.resumePlayback("panel")) await interaction.followUp({ content: "Playback is not paused.", ephemeral: true });
      } else if (action === "pause") {
        if (!await state.pausePlayback("panel")) await interaction.followUp({ content: "Nothing is playing.", ephemeral: true });
      } else if (action === "previous") await state.previous();
      else if (action === "next") await state.skip();
      else if (action === "loop") {
        state.loop = ["off", "track", "queue"][(["off", "track", "queue"].indexOf(state.loop) + 1) % 3];
        state.queueChanged();
      } else if (action === "vol-down") state.adjustVolume(-10);
      else if (action === "vol-up") state.adjustVolume(10);
      else if (action === "rewind" || action === "forward") {
        if (!state.current) throw new Error("No current track for seeking.");
        const position = playbackPosition(state) + (action === "rewind" ? -10 : 10);
        await state.seek(Math.max(0, Math.min(position, Math.max(0, state.current.duration - 2))));
      } else if (action === "shuffle") state.shuffle();
      else if (action === "stop") state.stop();
      else await interaction.followUp({ content: "This control is not available yet.", ephemeral: true });
      state.panel?.scheduleUpdate();
    } catch (error) {
      log(`[panel:${interaction.guild.id}:${action}] ${error?.stack || error?.message || String(error)}`);
      await interaction.followUp({ content: "Could not use that control. Try again or check the bot's permissions.", ephemeral: true, allowedMentions: { parse: [] } }).catch(() => {});
    }
    return true;
    } finally {
      if (action === "next") skipping.delete(state);
    }
  };
  return async interaction => {
    try { return await handle(interaction); }
    catch (error) {
      log(`[panel:${interaction.guild?.id || "unknown"}] Interaction failed: ${error?.stack || error?.message || String(error)}`);
      const payload = { content: "Could not use that control. Please try again.", ephemeral: true, allowedMentions: { parse: [] } };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch { /* Expired/failed acknowledgements must not terminate the bot. */ }
      return true;
    }
  };
}
module.exports = { createPanelInteractionHandler, ACTION_PERMISSIONS };
