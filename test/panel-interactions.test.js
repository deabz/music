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
    previous: async () => calls.push("previous"),
    skip: async () => calls.push("skip"), queueChanged: () => calls.push("queueChanged"),
    adjustVolume: amount => calls.push(amount), seek: async position => calls.push(position),
    shuffle: () => calls.push("shuffle"), stop: () => calls.push("stop") };
  const interaction = { customId: "panel:" + action, guild: { id: "guild", voiceStates: { cache: new Map([["listener", { channelId }]]) } }, message: { id: "message" },
    user: { id: "listener" }, isButton: () => true, member: { voice: { channelId } }, memberPermissions: new PermissionsBitField(permissions),
    reply: async value => calls.push(value), deferUpdate: async () => calls.push("defer"), followUp: async value => calls.push(value) };
  return { state, interaction, calls, handler: createPanelInteractionHandler({ getMusic: () => state, lyrics: { open: async (interaction, options) => interaction.reply({ content: "Mock lyrics", ephemeral: options.panel }) }, log() {} }) };
}
test("ordinary actions defer first, call existing methods, and schedule panel updates", async () => {
  for (const [action, expected] of [["play", "resume"], ["previous", "previous"], ["pause", "pause"], ["next", "skip"], ["loop", "queueChanged"],
    ["vol-down", -10], ["vol-up", 10], ["rewind", 0], ["forward", 15], ["shuffle", "shuffle"], ["stop", "stop"]]) {
    const f = fixture(action); await f.handler(f.interaction);
    assert.equal(f.calls[0], "defer", action); assert.equal(f.calls[1], expected, action);
    assert.equal(f.calls.at(-1), "update");
  }
  const f = fixture("loop");
  for (const mode of ["track", "queue", "off"]) { await f.handler(f.interaction); assert.equal(f.state.loop, mode); }
});

test("effects multi-select acknowledges before exactly one set replacement and rejects a second submission", async () => {
  const f = fixture("effects-apply"); f.interaction.customId += ":listener";
  f.interaction.values = ["bassboost", "echo"];
  let release, starts = 0;
  f.state.setAudioFilters = async values => {
    assert.equal(f.calls[0], "defer"); assert.deepEqual(values, ["bassboost", "echo"]); starts++;
    await new Promise(resolve => { release = resolve; });
    f.state.audioFilters = { bassboost: true, echo: true, nightcore: false, eightd: false };
  };
  f.interaction.editReply = async payload => f.calls.push(payload);
  const first = f.handler(f.interaction); await new Promise(setImmediate);
  await f.handler(f.interaction); assert.equal(starts, 1); assert.match(f.calls.at(-1).content, /Please wait/);
  release(); await first;
  const result = f.calls.find(value => value.content?.includes("Audio effects updated"));
  assert.match(result.content, /Bass boost, Echo/); assert.deepEqual(result.components, []);
  assert.equal(f.state.interactionRestarting, false);
});
test("playback panel controls require voice access even for Manage Server/Admin", async () => {
  for (const action of Object.keys(ACTION_PERMISSIONS).filter(action => !["lyrics", "favourite", "favourites"].includes(action))) {
    const f = fixture(action, "elsewhere");
    if (["effects-apply", "favourites-select"].includes(action)) f.interaction.customId += ":listener"; await f.handler(f.interaction);
    assert.equal(f.calls.length, 1, action); assert.equal(f.calls[0].ephemeral, true);
    assert.match(f.calls[0].content, /Join <#voice>/);
    for (const role of [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.Administrator]) {
      const manager = fixture(action, "voice", role);
      if (["effects-apply", "favourites-select"].includes(action)) { manager.interaction.customId += ":listener"; manager.state.setAudioFilters = async () => {}; manager.interaction.editReply = async () => {}; }
      await manager.handler(manager.interaction);
      assert.ok(!manager.calls.some(item => item.content?.includes("Join <#voice>")));
    }
  }
});
test("lyrics are private, stale panels are rejected, and errors never expose library details", async () => {
  const lyrics = fixture("lyrics"); await lyrics.handler(lyrics.interaction);
  assert.equal(lyrics.calls[0].ephemeral, true); assert.equal(lyrics.calls[0].content, "Mock lyrics");
  const stale = fixture("pause"); stale.interaction.message.id = "old"; await stale.handler(stale.interaction);
  assert.match(stale.calls[0].content, /old panel/);
  const failed = fixture("next"); failed.state.skip = async () => { throw new Error("PRIVATE_PATH"); };
  await failed.handler(failed.interaction);
  assert.equal(failed.calls[0], "defer"); assert.ok(!JSON.stringify(failed.calls).includes("PRIVATE_PATH"));
});

test("Next double clicks claim the guild before deferring, acknowledge both and release after failure", async () => {
  const f = fixture("next"); let release, skips = 0;
  f.interaction.deferUpdate = () => new Promise(resolve => { release = resolve; });
  f.state.skip = async () => { skips++; throw null; };
  const first = f.handler(f.interaction);
  const second = { ...f.interaction, reply: async payload => { assert.equal(payload.ephemeral, true); assert.match(payload.content, /already in progress/); } };
  await f.handler(second); assert.equal(skips, 0);
  release(); await first; assert.equal(skips, 1);
  assert.equal(f.calls.at(-1).ephemeral, true); assert.match(f.calls.at(-1).content, /Could not use/);
  f.interaction.deferUpdate = async () => {}; f.state.skip = async () => { skips++; };
  await f.handler(f.interaction); assert.equal(skips, 2);
});

test("errors before acknowledgement use a generic private reply, with follow-up after acknowledgement", async () => {
  for (const acknowledged of [false, true]) {
    const f = fixture("next");
    f.state.panel.wake = () => { throw new Error("PRIVATE_PATH"); };
    f.interaction.deferred = acknowledged;
    await f.handler(f.interaction);
    assert.equal(f.calls.at(-1).ephemeral, true); assert.match(f.calls.at(-1).content, /Could not use/);
    assert.ok(!JSON.stringify(f.calls).includes("PRIVATE_PATH"));
  }
});

test("Next on an idle panel acknowledges without starting or throwing", async () => {
  const f = fixture("next"); f.state.current = null; let skips = 0;
  f.state.skip = async () => { skips++; return false; };
  await f.handler(f.interaction);
  assert.equal(f.calls[0], "defer"); assert.equal(skips, 1); assert.equal(f.calls.at(-1), "update");
});

test("all playback actions refuse outside admins and owners ephemerally", async () => {
  for (const [action, permission] of Object.entries(ACTION_PERMISSIONS)) {
    if (permission === "read-only") continue;
    for (const role of [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.Administrator]) {
      const f = fixture(action, null, role); f.interaction.guild.ownerId = "listener";
      if (["effects-apply", "favourites-select"].includes(action)) f.interaction.customId += ":listener";
      await f.handler(f.interaction);
      assert.equal(f.calls.length, 1); assert.equal(f.calls[0].ephemeral, true); assert.match(f.calls[0].content, /Join <#voice>/);
    }
  }
});

test("effects menu rechecks current voice state on submit and after acknowledgement", async () => {
  const f = fixture("effects"); await f.handler(f.interaction);
  f.interaction.guild.voiceStates.cache.delete("listener");
  f.interaction.customId = "panel:effects-apply:listener"; f.interaction.values = ["echo"];
  let applied = 0; f.state.setAudioFilters = async () => { applied++; };
  await f.handler(f.interaction); assert.equal(applied, 0); assert.equal(f.calls.at(-1).ephemeral, true);
  f.interaction.guild.voiceStates.cache.set("listener", { channelId: "voice" });
  f.interaction.deferUpdate = async () => { f.interaction.guild.voiceStates.cache.delete("listener"); };
  await f.handler(f.interaction); assert.equal(applied, 0); assert.match(f.calls.at(-1).content, /Join <#voice>/);
});

test("heart and favourites browsing are open outside voice, but favourites queueing is refused", async () => {
  const f = fixture("favourite", null); let toggles = 0;
  const favourites = { toggle: async () => { toggles++; return "added"; }, list: () => [{ id: "saved", title: "Saved", url: "url", duration: 100 }] };
  const handler = createPanelInteractionHandler({ getMusic: () => f.state, favourites });
  await handler(f.interaction); assert.equal(toggles, 1);
  f.interaction.customId = "panel:favourites"; await handler(f.interaction);
  assert.match(f.calls.at(-2).content, /Choose/);
  f.interaction.customId = "panel:favourites-select:listener"; f.interaction.values = ["saved"];
  f.state.add = () => assert.fail("Outside listener must not queue a favourite");
  await handler(f.interaction); assert.match(f.calls.at(-1).content, /Join <#voice>/); assert.equal(f.calls.at(-1).ephemeral, true);
});

test("suggestion selection refuses if the listener leaves while channel fetch is pending", async () => {
  const f = fixture("suggest"); let restored = 0;
  f.interaction.values = ["song"];
  f.state.suggestions = { take: () => ({ id: "song", title: "Song" }), restore: () => { restored++; } };
  f.interaction.guild.channels = { fetch: async () => { f.interaction.guild.voiceStates.cache.delete("listener"); return { id: "voice" }; } };
  f.state.add = () => assert.fail("Listener left before adding");
  await f.handler(f.interaction); assert.equal(restored, 1); assert.equal(f.calls.at(-1).ephemeral, true);
});


test("effects menu preselects enabled filters and submits one exact set including empty", async () => {
  const f = fixture("effects"); f.state.audioFilters = { echo: true };
  await f.handler(f.interaction);
  const menu = f.calls[0].components[0].components[0];
  assert.equal(f.calls[0].ephemeral, true);
  assert.equal(menu.min_values, 0); assert.equal(menu.max_values, 4);
  assert.equal(menu.options.find(option => option.value === "echo").default, true);
  const applied = [];
  f.state.setAudioFilters = async values => applied.push(values);
  f.interaction.customId = "panel:effects-apply:listener";
  f.interaction.message.id = "ephemeral";
  f.interaction.editReply = async () => {};
  f.interaction.values = ["bassboost", "nightcore"];
  await f.handler(f.interaction);
  f.interaction.values = [];
  await f.handler(f.interaction);
  assert.deepEqual(applied, [["bassboost", "nightcore"], []]);
});


test("suggestion selection claims once, uses clicking requester and restores the option on add failure", async () => {
  const f = fixture("suggest");
  const selected = { id: "short", title: "Suggested", url: "url", duration: 120, autoSuggested: true };
  let available = true, restored = 0, added;
  f.state.suggestions = { take: id => id === "short" && available ? (available = false, selected) : null,
    restore: () => { restored++; available = true; } };
  f.interaction.values = ["short"];
  f.interaction.guild.channels = { fetch: async () => ({ id: "voice" }) };
  f.state.add = async (tracks, channel, user) => { added = { tracks, channel, user }; };
  await f.handler(f.interaction);
  assert.equal(added.user, "listener"); assert.equal(added.tracks[0].autoSuggested, false);
  assert.equal(added.channel.id, "voice"); assert.ok(!("id" in added.tracks[0]));
  await f.handler(f.interaction);
  assert.match(f.calls.at(-1).content, /no longer available/);
  available = true; f.state.add = async () => { throw new Error("full queue"); };
  await f.handler(f.interaction); assert.equal(restored, 1);
});


test("heart toggles a private per-user favourite and the private menu queues as its owner", async () => {
  const f = fixture("favourite");
  const records = [{ id: "fav1", title: "Saved", author: "Artist", url: "url", duration: 120 }];
  let toggles = 0, added;
  const favourites = { toggle: async (user, track) => { assert.equal(user, "listener"); assert.equal(track.title, "Song"); return ++toggles === 1 ? "added" : "removed"; }, list: user => { assert.equal(user, "listener"); return records; } };
  const handler = createPanelInteractionHandler({ getMusic: () => f.state, favourites, log() {} });
  await handler(f.interaction); assert.match(f.calls.at(-2).content, /Saved to your/);
  await handler(f.interaction); assert.match(f.calls.at(-2).content, /Removed/);
  f.interaction.customId = "panel:favourites";
  await handler(f.interaction);
  const menu = f.calls.at(-2); assert.equal(menu.ephemeral, true);
  assert.equal(menu.components[0].components[0].options[0].value, "fav1");
  f.interaction.customId = "panel:favourites-select:listener"; f.interaction.values = ["fav1"];
  f.interaction.message.id = "private";
  f.interaction.guild.channels = { fetch: async () => ({ id: "voice" }) };
  f.state.add = async (tracks, _, user) => { added = { tracks, user }; };
  f.interaction.editReply = async () => {};
  await handler(f.interaction); assert.equal(added.user, "listener"); assert.equal(added.tracks[0].title, "Saved");
  f.interaction.user.id = "intruder"; added = null;
  await handler(f.interaction); assert.equal(added, null); assert.match(f.calls.at(-1).content, /another listener/);
});


test("expired acknowledgements are logged and cannot escape as unhandled rejections", async () => {
  const f = fixture("next"); let logs = 0;
  const handler = createPanelInteractionHandler({ getMusic: () => f.state, log: () => { logs++; } });
  f.interaction.deferUpdate = async () => { throw new Error("synthetic expired interaction"); };
  f.interaction.reply = async () => { throw new Error("already expired"); };
  assert.equal(await handler(f.interaction), true);
  assert.equal(logs, 1); assert.ok(!f.calls.includes("skip"));
});
