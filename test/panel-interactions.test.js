const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits, PermissionsBitField } = require("discord.js");
const { createPanelInteractionHandler, ACTION_PERMISSIONS } = require("../src/panel-interactions");
function fixture(action, channelId = "voice", permissions = 0n) {
  const calls = [];
  const state = { current: { title: "Song", author: "Artist", duration: 100 }, queue: [], loop: "off", volume: 100,
    resumeOffsetSeconds: 5, resource: { playbackDuration: 0 }, panelMessageId: "message",
    connection: { state: { status: "ready" }, joinConfig: { channelId: "voice" } },
    panel: { wake() {}, scheduleUpdate() { calls.push("update"); } },
    resumePlayback: async () => { calls.push("resume"); return true; }, pausePlayback: async () => { calls.push("pause"); return true; },
    skip: async () => calls.push("skip"), queueChanged: () => calls.push("queueChanged"),
    adjustVolume: amount => calls.push(amount), seek: async position => calls.push(position),
    shuffle: () => calls.push("shuffle"), stop: () => calls.push("stop") };
  const interaction = { customId: "panel:" + action, guild: { id: "guild" }, message: { id: "message" },
    isButton: () => true, member: { voice: { channelId } }, memberPermissions: new PermissionsBitField(permissions),
    reply: async value => calls.push(value), deferUpdate: async () => calls.push("defer"), followUp: async value => calls.push(value) };
  return { state, interaction, calls, handler: createPanelInteractionHandler({ getMusic: () => state, log() {} }) };
}
test("ordinary actions defer first, call existing methods, and schedule panel updates", async () => {
  for (const [action, expected] of [["play", "resume"], ["pause", "pause"], ["next", "skip"], ["loop", "queueChanged"],
    ["vol-down", -10], ["vol-up", 10], ["rewind", 0], ["forward", 15], ["shuffle", "shuffle"], ["stop", "stop"]]) {
    const f = fixture(action); await f.handler(f.interaction);
    assert.equal(f.calls[0], "defer", action); assert.equal(f.calls[1], expected, action);
    assert.equal(f.calls.at(-1), "update");
  }
  const f = fixture("loop");
  for (const mode of ["track", "queue", "off"]) { await f.handler(f.interaction); assert.equal(f.state.loop, mode); }
});
test("all panel controls require voice access, with Manage Server/Admin overrides", async () => {
  for (const action of Object.keys(ACTION_PERMISSIONS)) {
    const f = fixture(action, "elsewhere"); await f.handler(f.interaction);
    assert.equal(f.calls.length, 1, action); assert.equal(f.calls[0].ephemeral, true);
    assert.match(f.calls[0].content, /voice channel/);
    for (const role of [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.Administrator]) {
      const manager = fixture(action, "elsewhere", role); await manager.handler(manager.interaction);
      assert.ok(!manager.calls.some(item => item.content?.includes("Join the bot's voice channel")));
    }
  }
});
test("lyrics are private, stale panels are rejected, and errors never expose library details", async () => {
  const lyrics = fixture("lyrics"); await lyrics.handler(lyrics.interaction);
  assert.equal(lyrics.calls[0].ephemeral, true); assert.match(lyrics.calls[0].content, /genius.com/);
  const stale = fixture("pause"); stale.interaction.message.id = "old"; await stale.handler(stale.interaction);
  assert.match(stale.calls[0].content, /old panel/);
  const failed = fixture("next"); failed.state.skip = async () => { throw new Error("PRIVATE_PATH"); };
  await failed.handler(failed.interaction);
  assert.equal(failed.calls[0], "defer"); assert.ok(!JSON.stringify(failed.calls).includes("PRIVATE_PATH"));
});
