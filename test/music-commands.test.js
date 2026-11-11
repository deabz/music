const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { commands, parsePrefixCommand, formatDuration } = require("../src/commands");
const { AudioPlayerStatus } = require("@discordjs/voice");

const source = fs.readFileSync(require.resolve("../src/index"), "utf8");
const quietConsole = { log() {}, error() {} };

// Evaluate the actual handlers without logging in or starting the HTTP server.
function eventHandler(event, overrides = {}) {
  const marker = `client.on(Events.${event},`;
  const start = source.indexOf(marker);
  const end = source.indexOf("\n});", start) + 4;
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    client: { on: (_, callback) => { handler = callback; } },
    Events: { [event]: event },
    commands,
    parsePrefixCommand,
    AudioPlayerStatus,
    clearTimeout,
    ...overrides
  });
  return handler;
}

function commandHandler(state, overrides = {}) {
  const start = source.indexOf("const handleCommand =");
  const end = source.indexOf("\nclient.on(Events.VoiceStateUpdate", start);
  return vm.runInNewContext(`${source.slice(start, end)}\nhandleCommand;`, {
    getMusic: () => state,
    reply: (interaction, content) => interaction.reply(content),
    formatDuration,
    console: quietConsole,
    require,
    ...overrides
  });
}

function guildMusicClass(overrides = {}) {
  const start = source.indexOf("class GuildMusic {");
  const end = source.indexOf("\nconst client =", start);
  return vm.runInNewContext(`${source.slice(start, end)}\nGuildMusic;`, {
    AudioPlayerStatus,
    scheduleMusicSave() {},
    config: { leaveOnEmpty: true, emptyTimeout: 5 },
    setTimeout,
    clearTimeout,
    ...overrides
  });
}

test("downloader failure after EOF stops playback without repeat or autoplay and preserves queue", async () => {
  const notices = [];
  const GuildMusic = guildMusicClass({ console: quietConsole, updatePresence() {} });
  const state = Object.create(GuildMusic.prototype);
  const track = { title: "Blocked song" };
  const queue = [{ title: "Queued song" }];
  let rejectDownload;
  const download = new Promise((_, reject) => { rejectDownload = reject; });
  download.kill = () => {};
  Object.assign(state, {
    guild: { id: "guild", client: { channels: { cache: new Map([["text", { send: async message => notices.push(message) }]]) } } },
    notificationChannelId: "text", current: track, queue, playing: true,
    streamProcess: download, loop: "track",
    player: { stop() { state.onTrackEnd(); } }
  });
  state.playNext = () => assert.fail("Failed downloads must not enter repeat or autoplay");
  const ended = state.onTrackEnd();
  assert.equal(state.current, track, "EOF must wait for downloader result");
  rejectDownload(new Error("HTTP Error 403: Forbidden"));
  await ended;
  assert.equal(state.current, null);
  assert.equal(state.playing, false);
  assert.equal(state.queue, queue);
  assert.equal(notices.length, 1);
  state.failPlayback(track, new Error("late failure"));
  assert.equal(notices.length, 1, "Late process callbacks must be ignored");
});

test("successful downloader completion advances once despite duplicate Idle events", async () => {
  const GuildMusic = guildMusicClass();
  const state = Object.create(GuildMusic.prototype);
  const track = { title: "Finished song" };
  Object.assign(state, { current: track, streamProcess: Promise.resolve(), loop: "off" });
  let advanced = 0;
  state.playNext = async ended => { assert.equal(ended, track); advanced++; };
  await Promise.all([state.onTrackEnd(), state.onTrackEnd()]);
  assert.equal(advanced, 1);
});

test("dot prefix parses commands and aliases case-insensitively", () => {
  for (const [content, name, args] of [
    [".play song", "play", "song"],
    [".p song", "play", "song"],
    [".q", "queue", ""],
    [".PLAY song", "play", "song"]
  ]) {
    assert.deepEqual(parsePrefixCommand(content), { name, args });
  }
  for (const content of [".", "..", "...", "..ok", ".. hello", ". hello", "hello .play", "'play"]) {
    assert.equal(parsePrefixCommand(content), null, content);
  }
});

test("ordinary dot messages and unknown commands are silently ignored", async () => {
  let dispatched = 0;
  let replies = 0;
  const handler = eventHandler("MessageCreate", { handleCommand: async () => { dispatched++; } });
  for (const content of [".", "..", "...", "..ok", ".. hello", ". hello", ".unknown song", "hello .play"]) {
    await handler({ content, guild: {}, member: {}, author: { bot: false }, reply: async () => { replies++; } });
  }
  assert.equal(dispatched, 0);
  assert.equal(replies, 0);
});

test("prefix adapter passes remove, move, search, forward and normalized options", async () => {
  let context;
  const handler = eventHandler("MessageCreate", { handleCommand: async value => { context = value; } });
  for (const [content, getter, option, expected] of [
    [".rm 3", "getInteger", "position", 3],
    [".mv 2   4", "getInteger", "from", 2],
    [".move 2 4", "getInteger", "to", 4],
    [".sr a song name", "getString", "query", "a song name"],
    [".forward 1:30", "getString", "time", "1:30"],
    [".forward", "getString", "time", null],
    [".loop QUEUE", "getString", "mode", "queue"],
    [".help PLAYBACK", "getString", "category", "playback"]
  ]) {
    await handler({ content, guild: {}, member: {}, author: { bot: false } });
    assert.equal(context.options[getter](option), expected, content);
  }
});

test("prefix queue positions reject missing, noninteger, nonpositive and extra arguments", async () => {
  let dispatched = 0;
  const handler = eventHandler("MessageCreate", { handleCommand: async () => { dispatched++; } });
  for (const content of [".move 1", ".move 0 2", ".move 1.5 2", ".move 1 2 3", ".move one two", ".remove -1", ".remove 1.5", ".remove 1 2"]) {
    let response;
    await handler({ content, guild: {}, member: {}, author: { bot: false }, reply: async value => { response = value.content; } });
    assert.match(response, /Usage:/, content);
  }
  assert.equal(dispatched, 0);
  assert.ok(!commands.some(command => command.name === "playlist"));
});

test("forward uses current position, defaults to ten seconds and validates time", async () => {
  const state = {
    current: { duration: 200 }, resumeOffsetSeconds: 20, resource: { playbackDuration: 5000 },
    async seek(seconds) { this.resumeOffsetSeconds = Math.min(seconds, this.current.duration - 2); }
  };
  const handler = commandHandler(state);
  for (const [time, target] of [[null, 35], ["10", 35], ["1:30", 115], ["999", 198]]) {
    state.resumeOffsetSeconds = 20;
    let response;
    await handler({ guild: {}, commandName: "forward", options: { getString: () => time }, deferReply: async () => {}, editReply: async value => { response = value; } });
    assert.equal(state.resumeOffsetSeconds, target);
    assert.equal(response, `Forwarded to ${formatDuration(target)}.`);
  }
  for (const time of ["0", "-1", "1:60", "abc", "1.5", "1:2", "1:00:00"]) {
    let response;
    await handler({ guild: {}, commandName: "forward", options: { getString: () => time }, reply: async value => { response = value; } });
    assert.match(response, /positive number/);
  }
  state.current = null;
  let response;
  await handler({ guild: {}, commandName: "forward", reply: async value => { response = value; } });
  assert.equal(response, "Nothing is playing.");
});

test("departures pause and schedule leave; returns resume only an empty-channel pause", async () => {
  assert.equal(source.split("client.on(Events.VoiceStateUpdate,").length - 1, 1);
  let count = 0;
  let pauses = 0;
  let resumes = 0;
  let schedules = 0;
  const messages = [];
  const state = {
    connection: { joinConfig: { channelId: "voice" } }, pausedForEmpty: false,
    player: { state: { status: AudioPlayerStatus.Playing } },
    async pausePlayback() { pauses++; this.player.state.status = AudioPlayerStatus.Paused; return true; },
    async resumePlayback() { resumes++; this.player.state.status = AudioPlayerStatus.Playing; return true; },
    scheduleEmptyDisconnect() { schedules++; this.emptyTimer = setTimeout(() => {}, 10000); }
  };
  const channel = { members: { filter: predicate => ({ size: [{ user: { bot: true } }, ...Array.from({ length: count }, () => ({ user: { bot: false } }))].filter(predicate).length }) } };
  const guild = { channels: { cache: new Map([["voice", channel]]) }, systemChannel: { send: async text => messages.push(text) } };
  const handler = eventHandler("VoiceStateUpdate", { getMusic: () => state });
  await handler({ channelId: "voice" }, { channelId: null, guild });
  assert.equal(pauses, 1);
  assert.equal(schedules, 1);
  assert.equal(state.pausedForEmpty, true);
  count = 1;
  await handler({ channelId: null }, { channelId: "voice", guild });
  assert.equal(resumes, 1);
  assert.equal(state.emptyTimer, null);
  assert.equal(state.pausedForEmpty, false);
  state.player.state.status = AudioPlayerStatus.Paused;
  await handler({ channelId: null }, { channelId: "voice", guild });
  assert.equal(resumes, 1);
  assert.equal(messages.length, 2);
});

test("manual pause/resume clear auto-resume and report player failure", async () => {
  const GuildMusic = guildMusicClass();
  const state = Object.create(GuildMusic.prototype);
  state.playing = true;
  state.pausedForEmpty = true;
  state.player = { state: { status: AudioPlayerStatus.Paused }, pause: () => true, unpause: () => true };
  assert.equal(await state.pausePlayback("manual"), false);
  assert.equal(state.pausedForEmpty, false);
  state.pausedForEmpty = true;
  assert.equal(await state.resumePlayback("dashboard"), true);
  assert.equal(state.pausedForEmpty, false);
  state.player.state.status = AudioPlayerStatus.Playing;
  state.player.pause = () => false;
  assert.equal(await state.pausePlayback("manual"), false);
  state.playing = false;
  const handler = commandHandler(state);
  for (const [commandName, expected] of [["pause", "Nothing is playing."], ["resume", "Playback is not paused."]]) {
    let response;
    await handler({ guild: {}, commandName, reply: async value => { response = value; } });
    assert.equal(response, expected);
  }
});

test("empty disconnect honors leave setting and timeout", async () => {
  const config = { leaveOnEmpty: true, emptyTimeout: 5 };
  const GuildMusic = guildMusicClass({ config });
  const state = Object.create(GuildMusic.prototype);
  let disconnected = false;
  state.disconnect = () => { disconnected = true; };
  state.scheduleEmptyDisconnect();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(disconnected, true);
  config.leaveOnEmpty = false;
  disconnected = false;
  state.scheduleEmptyDisconnect();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(disconnected, false);
});

test("invalid additions do not connect or move voice", async () => {
  const GuildMusic = guildMusicClass({ hasAllowedDuration: value => value > 0 && value <= 1800, MAX_TRACK_DURATION_SECONDS: 1800, config: { maxQueueSize: 1 } });
  const state = Object.create(GuildMusic.prototype);
  state.queue = [];
  let connections = 0;
  state.connect = async () => { connections++; };
  await assert.rejects(state.add([{ title: "long", duration: 1801 }]), /30 minutes/);
  await assert.rejects(state.add([{ duration: 60 }, { duration: 60 }]), /at most 1/);
  assert.equal(connections, 0);
});

test("search menu uses bounded values and reports selection failures ephemerally", async () => {
  const results = [{ title: "Song".repeat(40), channel: { name: "Artist".repeat(30) }, durationInSec: 60, url: "https://youtube.com/watch?v=test", thumbnails: [{ url: "https://example.com/art.jpg" }] }];
  let collect;
  let payload;
  let added;
  const state = { async add(tracks) { added = tracks[0]; } };
  const handler = commandHandler(state, { searchYouTube: async () => results });
  await handler({
    guild: {}, commandName: "search", user: { id: "user" }, options: { getString: () => "song" },
    deferReply: async () => {}, editReply: async value => {
      payload = value;
      return { createMessageComponentCollector: () => ({ on: (event, callback) => { if (event === "collect") collect = callback; } }) };
    }
  });
  const option = payload.components[0].toJSON().components[0].options[0];
  assert.equal(option.value, "0");
  assert.equal(option.description.length, 100);
  const selection = {
    user: { id: "user" }, values: ["0"], member: { voice: { channel: {} } },
    async deferUpdate() { this.deferred = true; }, editReply: async () => {}
  };
  await collect(selection);
  assert.equal(added.url, results[0].url);
  assert.equal(added.duration, 60);
  let failure;
  state.add = async () => { throw new Error("Cannot connect"); };
  selection.followUp = async value => { failure = value; };
  await collect(selection);
  assert.equal(failure.content, "Cannot connect");
  assert.equal(failure.ephemeral, true);
});
