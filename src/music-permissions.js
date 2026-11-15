const { PermissionFlagsBits } = require("discord.js");
const controls = new Set(["pause", "resume", "skip", "stop", "leave", "clear", "remove", "move",
  "shuffle", "loop", "volume", "volup", "voldown", "bassboost", "eightd", "nightcore", "echo", "forward"]);
function currentVoiceChannelId(interaction) {
  return interaction.guild?.voiceStates?.cache?.get(interaction.user?.id)?.channelId || null;
}
async function resolveMemberVoiceChannel(interaction) {
  const channelId = currentVoiceChannelId(interaction);
  return channelId ? interaction.guild.channels.fetch(channelId) : null;
}
function botVoiceChannelId(state) {
  const connection = state?.connection;
  return connection?.state?.status !== "destroyed" ? connection?.joinConfig?.channelId || null : null;
}
function playbackControlError(interaction, state) {
  const botChannel = botVoiceChannelId(state);
  if (!botChannel) return "The bot is not connected to a voice channel.";
  return currentVoiceChannelId(interaction) === botChannel ? null : `Join <#${botChannel}> to control the music.`;
}
function musicAccessError(interaction, state, command = interaction.commandName) {
  const permissions = interaction.memberPermissions;
  const manager = permissions?.has(PermissionFlagsBits.ManageGuild)
    || permissions?.has(PermissionFlagsBits.Administrator);
  if (["set-notification-channel", "247"].includes(command) && !manager) return "You need Manage Server to use this command.";
  if (controls.has(command)) return playbackControlError(interaction, state);
  const botChannel = botVoiceChannelId(state);
  if (["play", "join", "247"].includes(command) && state?.playing && state?.current && botChannel) {
    return playbackControlError(interaction, state);
  }
  return null;
}
module.exports = { musicAccessError, playbackControlError, currentVoiceChannelId, resolveMemberVoiceChannel };
