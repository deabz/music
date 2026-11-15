const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { commands, buildHelpEmbed, formatDuration } = require("../src/commands");
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
    playbackPosition: require("../src/playback-position").playbackPosition,
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
    playbackPosition: require("../src/playback-position").playbackPosition,
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

test("messages only answer mentions, with per-channel cooldown and bot filtering", async () => {
  const { createMentionHandler } = require("../src/mentions");
  let time = 0;
  const handler = createMentionHandler(() => "123", () => time);
  const replies = [];
  const message = content => ({ content, channelId: "one", guild: {}, author: { bot: false }, reply: async value => replies.push(value) });
  for (const content of [".play song", ".p song", ".q", ".np", ".bb", ".8d", ".nc", ".ec", ".rm 1", "hello", "hi <@123>", "<@123>suffix"]) await handler(message(content));
  assert.equal(replies.length, 0);
  await handler(message("<@123>"));
  await handler(message("<@!123> help"));
  assert.equal(replies.length, 1);
  await handler({ ...message("<@123>"), channelId: "two", author: { bot: true } });
  assert.equal(replies.length, 1);
  await handler({ ...message("<@123>"), channelId: "two" });
  assert.equal(replies.length, 2);
  time = 10001;
  await handler(message("<@!123> help"));
  assert.equal(replies.length, 3);
  assert.match(replies[0].content, /slash commands/);
  assert.ok(!source.includes("MessageContent"));
});

test("help covers every registered slash command once, within Discord field limits", () => {
  const embed = buildHelpEmbed("all").toJSON();
  assert.deepEqual(embed.fields.map(field => field.name), ["Playback", "Queue", "Audio effects", "Info"]);
  for (const command of commands) assert.equal(embed.fields.flatMap(field => [...field.value.matchAll(/`\/([a-z0-9-]+)/g)].map(match => match[1])).filter(name => name === command.name).length, 1, command.name);
  for (const field of embed.fields) assert.ok(field.value.length <= 1024, field.name);
  assert.ok(!embed.description.includes("shortcut"));
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

test("every registered slash command dispatches and responds with valid arguments", async () => {
  const builders = require("../src/commands");
  const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
  const { buildGeniusSearchUrl } = require("../src/music-utils");
  for (const command of commands) {
    const responses = [];
    const effects = [];
    const state = {
      current: { title: "Test track", author: "Artist", duration: 120 },
      queue: [{ title: "Queued one" }, { title: "Queued two" }],
      playing: true, volume: 80, totalTracksPlayed: 1,
      resumeOffsetSeconds: 0, resource: { playbackDuration: 10000 },
      audioFilters: { bassboost: false, eightd: false, nightcore: false, echo: false },
      player: { stop: () => effects.push("skip") },
      setAudioFilter: (...args) => effects.push(args),
      async add() { effects.push("add"); },
      async connect() { effects.push("connect"); },
      async pausePlayback() { return true; }, async resumePlayback() { return true; },
      async seek(value) { this.resumeOffsetSeconds = value; },
      stop: () => effects.push("stop"), disconnect: () => effects.push("disconnect"),
      shuffle: () => 2,
      setVolume(value) { this.volume = value; }, adjustVolume(value) { this.volume += value; },
      moveTrack: () => true, clearQueue() { this.queue = []; }
    };
    const channel = { id: "text", permissionsFor: () => ({ has: () => true }) };
    const interaction = {
      commandName: command.name,
      guild: { channels: { fetch: async () => channel }, members: { me: {} } },
      user: { id: "user", username: "Listener", displayAvatarURL: () => "https://example.com/avatar.png" },
      member: { voice: { channel } }, channel,
      options: {
        getString: name => ({ query: "Test track", category: "all", time: "10", mode: "queue" })[name],
        getInteger: name => ({ percent: 90, position: 1, from: 1, to: 2 })[name],
        getChannel: () => channel
      },
      async deferReply() { this.deferred = true; },
      reply: async payload => { responses.push(payload); },
      editReply: async payload => { responses.push(payload); }
    };
    const handler = commandHandler(state, {
      ...builders, EmbedBuilder, PermissionFlagsBits, buildGeniusSearchUrl,
      client: { ws: { ping: 12 } }, Date, startedAt: Date.now() - 1000,
      formatUptime: () => "1s", scheduleMusicSave() {},
      config: { voiceChannelId: "voice", voiceGuildId: "guild" },
      resolveQuery: async () => [{ title: "Resolved", duration: 120 }],
      postLiveNowPlaying: async () => { responses.push("Live card"); },
      replyWithQueue: async () => { responses.push("Queue card"); },
      searchYouTube: async () => []
    });
    await handler(interaction);
    await new Promise(setImmediate);
    assert.ok(responses.length > 0, `/${command.name} did not respond`);
    for (const response of responses) {
      const text = typeof response === "string" ? response : response.content || "";
      assert.ok(!/not defined|not a function|Something went wrong|An error occurred/.test(text), `/${command.name}: ${text}`);
    }
  }
});

test("new tracks reset old seek offsets while explicit restarts preserve theirs", async () => {
  const GuildMusic = guildMusicClass({ console: quietConsole, updatePresence() {}, ytdlp: { exec() { throw new Error("Synthetic stream boundary"); } } });
  const state = Object.create(GuildMusic.prototype);
  Object.assign(state, {
    guild: { id: "test" }, queue: [{ title: "Fresh", url: "https://example.com/audio", duration: 180 }],
    audioFilters: {}, resumeOffsetSeconds: 60, totalTracksPlayed: 0,
    autoplayTriedUrls: new Set(), failPlayback() {}
  });
  await state.playNext();
  assert.equal(state.resumeOffsetSeconds, 0);
  await state.playNext(null, { title: "Restarted", url: "https://example.com/audio", resumeAtSeconds: 27 });
  assert.equal(state.resumeOffsetSeconds, 27);
});
