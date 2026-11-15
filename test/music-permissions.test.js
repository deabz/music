const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionsBitField, PermissionFlagsBits, ChannelType } = require("discord.js");
const { musicAccessError } = require("../src/music-permissions");
const { commands } = require("../src/commands");
test("every playback control needs same-channel membership even for managers, admins and owners", () => {
  const state = { playing: true, current: {}, connection: { state: { status: "ready" }, joinConfig: { channelId: "voice" } } };
  for (const commandName of ["pause", "resume", "skip", "stop", "leave", "clear", "remove", "move", "shuffle", "loop", "volume", "volup", "voldown", "bassboost", "eightd", "nightcore", "echo", "forward"]) {
    for (const role of [0n, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.Administrator]) {
      const interaction = { commandName, user: { id: "user" }, guild: { ownerId: "user", voiceStates: { cache: new Map([["user", { channelId: "elsewhere" }]]) } }, member: { voice: { channelId: "voice" } }, memberPermissions: new PermissionsBitField(role) };
      assert.ok(musicAccessError(interaction, state), commandName);
      interaction.guild.voiceStates.cache.set("user", { channelId: "voice" });
      assert.equal(musicAccessError(interaction, state), null);
    }
  }
});
test("play/join protect active sessions; idle sessions can be moved", () => {
  const state = { playing: true, current: {}, connection: { state: { status: "ready" }, joinConfig: { channelId: "voice" } } };
  for (const commandName of ["play", "join"]) {
    const interaction = { commandName, user: { id: "user" }, guild: { voiceStates: { cache: new Map([["user", { channelId: "elsewhere" }]]) } } };
    assert.ok(musicAccessError(interaction, state));
    state.playing = false; assert.equal(musicAccessError(interaction, state), null); state.playing = true;
    interaction.memberPermissions = new PermissionsBitField(PermissionFlagsBits.ManageGuild);
    assert.ok(musicAccessError(interaction, state));
  }
});
test("notification command declares Manage Server and only text/announcement channels", () => {
  const command = commands.find(item => item.name === "set-notification-channel");
  assert.equal(command.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
  assert.deepEqual(command.options[0].channel_types, [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
  assert.ok(musicAccessError({ commandName: command.name }, {}));
});

test("missing voice states fail closed and current cache wins over stale or missing members", () => {
  const state = { connection: { state: { status: "ready" }, joinConfig: { channelId: "voice" } } };
  const interaction = { commandName: "stop", user: { id: "user" }, member: { voice: { channelId: "voice" } }, guild: { voiceStates: { cache: new Map() } } };
  assert.match(musicAccessError(interaction, state), /Join <#voice>/);
  interaction.guild.voiceStates.cache.set("user", { channelId: null }); assert.ok(musicAccessError(interaction, state));
  interaction.guild.voiceStates.cache.set("user", { channelId: "voice" }); delete interaction.member;
  assert.equal(musicAccessError(interaction, state), null);
  for (const connection of [null, { state: { status: "destroyed" }, joinConfig: { channelId: "voice" } }]) {
    assert.match(musicAccessError(interaction, { connection }), /not connected/);
  }
  assert.doesNotThrow(() => musicAccessError({ commandName: "stop" }, {}));
});

test("read-only commands remain open while admin settings retain Manage Server", () => {
  for (const commandName of ["lyrics", "queue", "help", "ping", "uptime", "stats", "nowplaying", "read-only"]) {
    assert.equal(musicAccessError({ commandName }, {}), null);
  }
  for (const commandName of ["247", "set-notification-channel"]) {
    assert.equal(commands.find(command => command.name === commandName).default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
    assert.match(musicAccessError({ commandName }, {}), /Manage Server/);
    const interaction = { commandName, user: { id: "owner" }, guild: { ownerId: "owner", voiceStates: { cache: new Map() } }, memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) };
    const state = { playing: true, current: {}, connection: { state: { status: "ready" }, joinConfig: { channelId: "voice" } } };
    assert.equal(Boolean(musicAccessError(interaction, state)), commandName === "247");
    interaction.guild.voiceStates.cache.set("owner", { channelId: "voice" });
    assert.equal(musicAccessError(interaction, state), null);
  }
});
