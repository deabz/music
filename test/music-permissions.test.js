const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionsBitField, PermissionFlagsBits, ChannelType } = require("discord.js");
const { musicAccessError } = require("../src/music-permissions");
const { commands } = require("../src/commands");
test("every playback control needs same-channel membership or a manager/admin override", () => {
  const state = { playing: true, current: {}, connection: { state: { status: "ready" }, joinConfig: { channelId: "voice" } } };
  for (const commandName of ["pause", "resume", "skip", "stop", "leave", "clear", "remove", "move", "shuffle", "loop", "volume", "volup", "voldown", "bassboost", "eightd", "nightcore", "echo", "forward"]) {
    for (const role of [0n, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.Administrator]) {
      const interaction = { commandName, member: { voice: { channelId: "elsewhere" } }, memberPermissions: new PermissionsBitField(role) };
      assert.equal(Boolean(musicAccessError(interaction, state)), role === 0n, commandName);
      interaction.member.voice.channelId = "voice";
      assert.equal(musicAccessError(interaction, state), null);
    }
  }
});
test("play/join protect active sessions; idle sessions can be moved", () => {
  const state = { playing: true, current: {}, connection: { state: { status: "ready" }, joinConfig: { channelId: "voice" } } };
  for (const commandName of ["play", "join"]) {
    const interaction = { commandName, member: { voice: { channelId: "elsewhere" } } };
    assert.ok(musicAccessError(interaction, state));
    state.playing = false; assert.equal(musicAccessError(interaction, state), null); state.playing = true;
    interaction.memberPermissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
    assert.equal(musicAccessError(interaction, state), null);
  }
});
test("notification command declares Manage Server and only text/announcement channels", () => {
  const command = commands.find(item => item.name === "set-notification-channel");
  assert.equal(command.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
  assert.deepEqual(command.options[0].channel_types, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  assert.ok(musicAccessError({ commandName: command.name }, {}));
});
