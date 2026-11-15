const { musicAccessError } = require("./music-permissions");
const { playbackPosition } = require("./playback-position");
const { buildGeniusSearchUrl } = require("./music-utils");
const { PANEL_PREFIX } = require("./player-panel");

const ACTION_PERMISSIONS = {
  play: "resume", previous: "forward", pause: "pause", next: "skip", loop: "loop",
  "vol-down": "voldown", rewind: "forward", favourite: "volume", forward: "forward", "vol-up": "volup",
  lyrics: "forward", shuffle: "shuffle", stop: "stop", effects: "echo", favourites: "volume", suggest: "volume"
};
const privateReply = (interaction, content) => interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
function createPanelInteractionHandler({ getMusic, isReady = () => true, log = console.error } = {}) {
  return async interaction => {
    if (!interaction.customId?.startsWith(PANEL_PREFIX) || !(interaction.isButton?.() || interaction.isStringSelectMenu?.())) return false;
    if (!interaction.guild || !isReady()) {
      await privateReply(interaction, "The player is unavailable while the bot initializes or shuts down.");
      return true;
    }
    const action = interaction.customId.slice(PANEL_PREFIX.length);
    const permission = ACTION_PERMISSIONS[action];
    if (!permission) { await privateReply(interaction, "This player control is unavailable."); return true; }
    const state = getMusic(interaction.guild);
    const denied = musicAccessError(interaction, state, permission);
    if (denied) { await privateReply(interaction, denied); return true; }
    if (state.panelMessageId && interaction.message?.id !== state.panelMessageId) {
      await privateReply(interaction, "This is an old panel. Use /nowplaying to bring back the current player.");
      return true;
    }
    state.panel?.wake();
    if (action === "lyrics") {
      await privateReply(interaction, state.current
        ? buildGeniusSearchUrl(state.current.title, state.current.author) : "Nothing is playing.");
      return true;
    }
    await interaction.deferUpdate();
    try {
      if (action === "play") {
        if (!await state.resumePlayback("panel")) await interaction.followUp({ content: "Playback is not paused.", ephemeral: true });
      } else if (action === "pause") {
        if (!await state.pausePlayback("panel")) await interaction.followUp({ content: "Nothing is playing.", ephemeral: true });
      } else if (action === "next") await state.skip();
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
      log(`[panel:${interaction.guild.id}:${action}] ${error.stack || error.message}`);
      await interaction.followUp({ content: "Could not use that control. Try again or check the bot's permissions.", ephemeral: true }).catch(() => {});
    }
    return true;
  };
}
module.exports = { createPanelInteractionHandler, ACTION_PERMISSIONS };
