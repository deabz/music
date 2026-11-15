const { PermissionFlagsBits } = require("discord.js");
const controls = new Set(["pause", "resume", "skip", "stop", "leave", "clear", "remove", "move",
  "shuffle", "loop", "volume", "volup", "voldown", "bassboost", "eightd", "nightcore", "echo", "forward"]);
function musicAccessError(interaction, state, command = interaction.commandName) {
  const permissions = interaction.memberPermissions;
  const manager = permissions?.has(PermissionFlagsBits.ManageGuild)
    || permissions?.has(PermissionFlagsBits.Administrator);
  if (["set-notification-channel", "247"].includes(command) && !manager) return "You need Manage Server to use this command.";
  if (manager) return null;
  const channelId = interaction.member?.voice?.channelId || interaction.member?.voice?.channel?.id;
  const connection = state.connection;
  const botChannel = connection && connection.state.status !== "destroyed" ? connection.joinConfig.channelId : null;
  if (controls.has(command) && (!botChannel || channelId !== botChannel)) return "Join the bot's voice channel to use this control.";
  if (["play", "join"].includes(command) && state.playing && state.current && botChannel && channelId !== botChannel) {
    return "Music is active in another voice channel. Join that channel or ask someone with Manage Server to move the bot.";
  }
  return null;
}
module.exports = { musicAccessError };
