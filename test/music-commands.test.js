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
    startupComplete: true, shuttingDown: false,
    getMusic: () => state,
    musicAccessError: () => null,
    ChannelType: require("discord.js").ChannelType,
    reply: (interaction, content) => interaction.reply(content),
    formatDuration,
    playbackPosition: require("../src/playback-position").playbackPosition,
    console: quietConsole,
    require,
    scheduleMusicSave() {},
    ...overrides
  });
}

function guildMusicClass(overrides = {}) {
  const start = source.indexOf("class GuildMusic {");
  const end = source.indexOf("\nconst client =", start);
  return vm.runInNewContext(`${source.slice(start, end)}\nGuildMusic;`, {
    AudioPlayerStatus,
    ...require("../src/playback-errors"),
    playbackPosition: require("../src/playback-position").playbackPosition,
    shuttingDown: false,
    AbortController,
    createAudioPipeline() { throw new Error("Synthetic stream boundary"); },
    console: quietConsole,
    updatePresence() {},
    scheduleMusicSave() {},
    config: { leaveOnEmpty: true, emptyTimeout: 5 },
    setTimeout,
    clearTimeout,
    ...overrides
  });
}

test("known downloader failure stops without repeat/autoplay and preserves queue", async () => {
  const notices = [];
  const GuildMusic = guildMusicClass();
  const state = Object.create(GuildMusic.prototype);
  const track = { title: "Blocked song" };
  const queue = [{ title: "Queued song" }];
  Object.assign(state, {
    guild: { id: "guild", client: { channels: { cache: new Map([["text", { send: async m => notices.push(m) }]]) } } },
    notificationChannelId: "text", current: track, queue, playing: true,
    activePipeline: { error: new Error("network failure"), cancel() {} }, loop: "track",
    player: { stop() { state.onTrackEnd(); } }
  });
  state.playNext = () => assert.fail("Known failures must not repeat");
  await state.onTrackEnd();
  assert.equal(state.current, null);
  assert.equal(state.queue, queue);
  assert.equal(notices.length, 1);
});

test("successful downloader completion advances once despite duplicate Idle events", async () => {
  const GuildMusic = guildMusicClass();
  const state = Object.create(GuildMusic.prototype);
  const track = { title: "Finished song" };
  Object.assign(state, { guild: { id: "test" }, current: track, loop: "off" });
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
  assert.match(failure.content, /Could not add/);
  assert.ok(!failure.content.includes("Cannot connect"));
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
      panel: { wake() {}, ensure: async () => {}, move: async () => ({ id: "message" }) },
      invalidateNext() {},
      queueChanged() {},
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
      skip: async () => { effects.push("skip"); return true; },
      stop: () => effects.push("stop"), disconnect: () => effects.push("disconnect"),
      shuffle: () => 2,
      setVolume(value) { this.volume = value; }, adjustVolume(value) { this.volume += value; },
      moveTrack: () => true, clearQueue() { this.queue = []; }
    };
    const channel = { id: "text", type: 0, permissionsFor: () => ({ has: () => true }) };
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


test("prefetched track is reused without another spawn and stop cancels both pipelines", async () => {
  let spawned = 0, cancelled = 0;
  const jobs = [];
  const GuildMusic = guildMusicClass({ createAudioPipeline() {
    spawned++;
    const job = { stream: {}, formatReady: true, inputType: "webm/opus", rate: 1, cancel() { cancelled++; } };
    jobs.push(job); return job;
  }, createAudioResource: () => ({ volume: { setVolume() {} } }) });
  const state = Object.create(GuildMusic.prototype);
  const first = { title: "first", url: "one" }, second = { title: "second", url: "two" };
  Object.assign(state, { guild: { id: "test" }, queue: [second], current: first, playing: true,
    loop: "off", nextGeneration: 0, totalTracksPlayed: 1, player: { play() {}, stop() {} } });
  state.prepareNext(); state.prepareNext();
  assert.equal(spawned, 1);
  await state.onTrackEnd();
  assert.equal(state.current, second);
  assert.equal(spawned, 1);
  assert.equal(state.activePipeline, jobs[0]);
  state.queue.push(first); state.prepareNext();
  state.stop();
  assert.equal(cancelled, 2);
  assert.equal(state.prefetch, null);
  assert.equal(state.activePipeline, null);
});

test("queue mutation ignores stale autoplay searches and cancels speculative audio", async () => {
  let resolve, cancelled = 0;
  const GuildMusic = guildMusicClass({ resolveSuggestedTrack: () => new Promise(r => { resolve = r; }),
    searchYouTube() {}, artworkFrom() {} });
  const state = Object.create(GuildMusic.prototype);
  Object.assign(state, { current: { title: "current" }, playing: true, queue: [], nextGeneration: 0,
    autoplayTriedUrls: new Set(), loop: "off" });
  state.prepareNext();
  state.prefetch = { job: { cancel() { cancelled++; } } };
  state.clearQueue();
  resolve({ title: "stale", url: "stale" });
  await new Promise(setImmediate);
  assert.equal(state.queue.length, 0);
  assert.equal(cancelled, 1);
});


test("instant Idle retries once, notifies, advances and limits consecutive failures", async () => {
  const GuildMusic = guildMusicClass();
  const state = Object.create(GuildMusic.prototype);
  let notices = 0, cancels = 0;
  Object.assign(state, { guild: { id: "test", client: { channels: { cache: new Map([["text", { send: async () => { notices++; } }]]) } } },
    notificationChannelId: "text", queue: [{ title: "next" }, { title: "kept" }],
    player: { stop() {} }, playing: true, resumeOffsetSeconds: 0 });
  const starts = [];
  state.playNext = async (_, track) => { starts.push(track || state.queue.shift()); };
  const short = retry => {
    state.current = { title: "short", duration: 180, streamRetry: retry };
    state.activePipeline = { startedAt: 1, cancel() { cancels++; } };
    state.resource = { playbackDuration: 100 };
  };
  short(0); await state.onTrackEnd();
  assert.equal(starts[0].streamRetry, 1);
  short(1); await state.onTrackEnd();
  assert.equal(starts[1].title, "next");
  assert.equal(notices, 1);
  short(1); await state.onTrackEnd();
  assert.equal(starts.length, 2);
  assert.equal(state.queue[0].title, "kept");
  assert.equal(state.playing, false);
  assert.equal(cancels, 3);
});


test("concurrent joins share one ready connection and duplicate starts are ignored", async () => {
  const { EventEmitter } = require("node:events");
  let joins = 0, release;
  const ready = new Promise(r => { release = r; });
  const connection = new EventEmitter();
  Object.assign(connection, { state: { status: "connecting" }, joinConfig: { channelId: "voice" }, subscribe() {}, destroy() { this.state.status = "destroyed"; } });
  const GuildMusic = guildMusicClass({ VoiceConnectionStatus: { Ready: "ready", Destroyed: "destroyed" },
    joinVoiceChannel() { joins++; return connection; }, entersState: () => ready });
  const state = Object.create(GuildMusic.prototype);
  Object.assign(state, { guild: { id: "guild" }, player: {}, queue: [] });
  const channel = { id: "voice", isVoiceBased: () => true, guild: { id: "guild" } };
  const one = state.connect(channel), two = state.connect(channel);
  connection.state.status = "ready"; release(connection);
  assert.equal(await one, connection); assert.equal(await two, connection);
  assert.equal(joins, 1);
  state.current = { title: "existing" }; state.playing = true;
  await state.playNext();
  assert.equal(state.current.title, "existing");
});

test("normal reconnect accepts Connecting and resumes without restarting track", async () => {
  let resumed = 0, connecting = false;
  const connection = { state: { status: "disconnected" } };
  const GuildMusic = guildMusicClass({ VoiceConnectionStatus: { Signalling: "signalling", Connecting: "connecting", Ready: "ready" },
    entersState: async (_, status) => {
      if (status === "signalling") throw new Error("not signalling");
      if (status === "connecting") connecting = true;
      return connection;
    } });
  const state = Object.create(GuildMusic.prototype);
  Object.assign(state, { connection, player: { state: { status: AudioPlayerStatus.Playing } },
    pausePlayback: async () => true, resumePlayback: async () => { resumed++; } });
  await state.recoverVoice(connection);
  assert.equal(connecting, true); assert.equal(resumed, 1);
  assert.equal(state.connection, connection);
});

test("failed reconnect clears destroyed connection, tries twice and preserves current position", async () => {
  let attempts = 0, destroyed = 0;
  const connection = { state: { status: "disconnected" }, destroy() { destroyed++; } };
  const GuildMusic = guildMusicClass({ VoiceConnectionStatus: { Signalling: "signalling", Connecting: "connecting", Ready: "ready", Destroyed: "destroyed" },
    entersState: async () => { throw new Error("timeout"); }, playbackPosition: () => 42 });
  const state = Object.create(GuildMusic.prototype);
  Object.assign(state, { guild: { id: "test", channels: { fetch: async () => ({}) } }, connection,
    current: { title: "saved" }, queue: [], playing: true, player: { state: {}, stop() {} },
    connect: async () => { attempts++; throw new Error("offline"); } });
  await state.recoverVoice(connection);
  assert.equal(attempts, 2); assert.equal(destroyed, 1);
  assert.equal(state.connection, null); assert.equal(state.current, null);
  assert.equal(state.queue[0].resumeAtSeconds, 42);
  assert.equal(state.playing, false);
});


test("dedicated skip cancels immediately, bypasses track loop, and rotates queue loop", async () => {
  for (const loop of ["off", "track", "queue"]) {
    const GuildMusic = guildMusicClass();
    const state = Object.create(GuildMusic.prototype);
    const current = { title: "current" }, next = { title: "next" };
    const events = [];
    Object.assign(state, { current, queue: [next], loop,
      activePipeline: { cancel() { events.push("kill"); } },
      prefetch: { job: { cancel() { events.push("cancel prefetch"); } } },
      player: { stop() { events.push("stop"); state.onTrackEnd(); } },
      playNext: async () => { events.push("next"); state.current = state.queue.shift(); } });
    await state.skip();
    assert.deepEqual(events, ["cancel prefetch", "kill", "stop", "next"]);
    assert.equal(state.current, next);
    assert.equal(state.queue.length, loop === "queue" ? 1 : 0);
    if (loop === "queue") assert.equal(state.queue[0], current);
  }
});

test("skipping last track schedules cancellable autoplay without waiting", async () => {
  let resolve;
  const GuildMusic = guildMusicClass({ resolveSuggestedTrack: () => new Promise(r => { resolve = r; }), searchYouTube() {}, artworkFrom() {} });
  const state = Object.create(GuildMusic.prototype);
  Object.assign(state, { current: { title: "last" }, queue: [], loop: "off", autoplayTriedUrls: new Set(),
    player: { stop() {} }, playNext: async () => {} });
  assert.equal(await state.skip(), true);
  assert.equal(typeof resolve, "function");
  state.stop();
  resolve({ title: "late", url: "late" });
  await new Promise(setImmediate);
  assert.equal(state.queue.length, 0);
});


test("queue numbers are waiting positions across pages, current appears separately", () => {
  const { buildQueueEmbed, buildQueueComponents } = require("../src/commands");
  const queue = Array.from({ length: 11 }, (_, index) => ({ title: "waiting " + (index + 1), author: "Artist" }));
  const current = { title: "current", author: "Artist" };
  const first = buildQueueEmbed({ current, queue, playbackStatus: "playing" }).toJSON();
  assert.equal(first.fields[0].name, "Now playing");
  assert.match(first.fields[0].value, /current/);
  assert.match(first.description, /\*\*#1\*\*\n\*\*waiting 1\*\*/);
  assert.match(first.description, /#10/); assert.ok(!first.description.includes("#11"));
  const second = buildQueueEmbed({ current, queue, page: 1 }).toJSON();
  assert.match(second.description, /#11/);
  assert.match(second.description, /waiting 11/);
  const buttons = buildQueueComponents({ current, queue: queue.slice(0, 10) })[0].toJSON();
  assert.equal(buttons.components[1].disabled, true);
});


test("notification channel is restored and additions do not overwrite it", async () => {
  const GuildMusic = guildMusicClass({ config: { maxQueueSize: 10, defaultVolume: 80 }, hasAllowedDuration: n => n > 0 && n <= 1800 });
  const state = Object.create(GuildMusic.prototype);
  Object.assign(state, { queue: [], autoplayTriedUrls: new Set(), connect: async () => {}, playNext: async () => {},
    prepareNext() {}, playing: false, player: { state: {} } });
  await state.restore({ voiceChannelId: "voice", notificationChannelId: "chosen", queue: [] }, {});
  assert.equal(state.notificationChannelId, "chosen");
  await state.add([{ title: "song", duration: 60 }], {}, "user", { id: "invoking" });
  assert.equal(state.notificationChannelId, "chosen");
  state.notificationChannelId = null;
  await state.add([{ title: "song", duration: 60 }], {}, "user", { id: "invoking" });
  assert.equal(state.notificationChannelId, "invoking");
  await assert.rejects(state.restoreState(null, {}), /Invalid saved snapshot/);
});

test("guild removal disconnects, deletes in-memory state and serializes stored deletion", async () => {
  let disconnected = 0, deleted;
  const music = new Map([["guild", { disconnect() { disconnected++; } }]]);
  const handler = eventHandler("GuildDelete", { music, savedMusicStates: { guild: {} }, musicSaveChain: Promise.resolve(),
    storage: { deleteGuild: async id => { deleted = id; } }, console: quietConsole });
  handler({ id: "guild" });
  await new Promise(setImmediate);
  assert.equal(disconnected, 1); assert.equal(music.has("guild"), false); assert.equal(deleted, "guild");
});

test("library errors are logged but Discord receives a generic response", async () => {
  let response;
  const handler = commandHandler({ connect: async () => { throw new Error("PRIVATE_PATH_AND_LIBRARY_DETAILS"); } });
  await handler({ guild: {}, commandName: "join", member: { voice: { channel: {} } },
    deferReply: async () => {}, reply: async text => { response = text; } });
  assert.ok(!JSON.stringify(response).includes("PRIVATE_PATH"));
  assert.match(response, /could not be completed/);
});


test("403 retries once at the current position; duplicate old callbacks cannot start another copy", async () => {
  const GuildMusic = guildMusicClass();
  const state = Object.create(GuildMusic.prototype);
  const track = { title: "403 song", duration: 180 };
  const starts = [], notices = [];
  Object.assign(state, { guild: { id: "test", client: { channels: { cache: new Map([["text", { send: async value => notices.push(value) }]]) } } },
    notificationChannelId: "text", current: track, playing: true, queue: [{ title: "kept" }], resumeOffsetSeconds: 10,
    resource: { playbackDuration: 5000 }, player: { state: {}, stop() {} },
    activePipeline: { stderr: "HTTP Error 403: Forbidden", cancel() {} } });
  state.playNext = async (_, retry) => {
    starts.push(retry); state.current = retry;
    state.activePipeline = { stderr: "HTTP Error 403: Forbidden", cancel() {} };
  };
  await state.failPlayback(track, new Error("403"));
  assert.equal(starts.length, 1); assert.equal(starts[0].http403Retries, 1);
  assert.equal(starts[0].resumeAtSeconds, 15);
  await state.failPlayback(track, new Error("late duplicate 403"));
  assert.equal(starts.length, 1);
  await state.failPlayback(state.current, new Error("403"));
  assert.equal(starts.length, 1); assert.equal(notices.length, 1);
  assert.match(notices[0].content, /refused the download \(403\)/);
  assert.equal(state.queue[0].title, "kept");
});

test("identified non-403 download errors do not retry even within three seconds", () => {
  const GuildMusic = guildMusicClass();
  const state = Object.create(GuildMusic.prototype);
  Object.assign(state, { guild: { id: "test", client: { channels: { cache: new Map() } } },
    current: { title: "limited", duration: 180 }, queue: [], playing: true, resumeOffsetSeconds: 0,
    activePipeline: { startedAt: 1, stderr: "HTTP Error 429", cancel() {} }, resource: { playbackDuration: 100 },
    player: { stop() {} } });
  state.playNext = () => assert.fail("429 must not be retried");
  state.failPlayback(state.current, new Error("429"));
  assert.equal(state.current, null);
});


test("stop during format probing cannot play a stale resource or start a duplicate track", async () => {
  let spawned = 0, played = 0, release;
  const GuildMusic = guildMusicClass({ createAudioPipeline() {
    spawned++;
    return { ready: new Promise(r => { release = r; }), cancel() { this.intentionallyAborted = true; release(); } };
  }, createAudioResource: () => assert.fail("Cancelled probe must not make a resource") });
  const state = Object.create(GuildMusic.prototype);
  Object.assign(state, { guild: { id: "test" }, queue: [{ title: "first" }, { title: "second" }],
    totalTracksPlayed: 0, player: { play() { played++; }, stop() {} } });
  const first = state.playNext();
  await state.playNext();
  assert.equal(spawned, 1);
  state.stop();
  await first;
  assert.equal(played, 0); assert.equal(state.current, null);
});


test("history retains the last twenty completed/skipped tracks without stream retry metadata", () => {
  const GuildMusic = guildMusicClass();
  const state = Object.create(GuildMusic.prototype);
  for (let i = 0; i < 25; i++) state.rememberPlayed({ title: String(i), url: String(i), http403Retries: 1 });
  assert.equal(state.history.length, 20);
  assert.equal(state.history[0].title, "5");
  assert.ok(!("http403Retries" in state.history[0]));
});

test("previous restarts after five seconds or without history; otherwise restores history and invalidates prefetch", async () => {
  const GuildMusic = guildMusicClass();
  for (const [position, history] of [[6, [{ title: "old" }]], [2, []]]) {
    const state = Object.create(GuildMusic.prototype);
    let seek;
    Object.assign(state, { current: { title: "now", duration: 100 }, history, resource: { playbackDuration: position * 1000 },
      seek: async value => { seek = value; } });
    await state.previous(); assert.equal(seek, 0);
  }
  const state = Object.create(GuildMusic.prototype);
  const events = [];
  Object.assign(state, { current: { title: "now", duration: 100 }, history: [{ title: "old" }], queue: [{ title: "next" }],
    resource: { playbackDuration: 2000 }, prefetch: { job: { cancel() { events.push("prefetch cancelled"); } } },
    activePipeline: { cancel() { events.push("active cancelled"); } },
    player: { state: { status: AudioPlayerStatus.Paused }, stop() { state.onTrackEnd(); } },
    playNext: async (_, track) => { events.push(track.title); state.current = track; } });
  await state.previous();
  assert.deepEqual(events, ["prefetch cancelled", "active cancelled", "old"]);
  assert.equal(state.current.title, "old"); assert.equal(state.queue[0].title, "now");
  assert.equal(state.history.length, 0); assert.equal(state.pauseOnRestore, true);
});


test("setting all effects restarts exactly once at the same paused position and cancels prefetch", async () => {
  const GuildMusic = guildMusicClass();
  const state = Object.create(GuildMusic.prototype);
  let starts = 0, cancels = 0;
  Object.assign(state, { current: { title: "Song", duration: 100 }, playing: true, resumeOffsetSeconds: 10,
    resource: { playbackDuration: 5000 }, player: { state: { status: AudioPlayerStatus.Paused } },
    audioFilters: { bassboost: false, eightd: false, nightcore: false, echo: true },
    prefetch: { job: { cancel() { cancels++; } } },
    playNext: async (_, track) => { starts++; assert.equal(track.resumeAtSeconds, 15); } });
  await state.setAudioFilters(["bassboost", "nightcore"]);
  assert.equal(starts, 1); assert.equal(cancels, 1); assert.equal(state.pauseOnRestore, true);
  assert.equal(state.audioFilters.echo, false); assert.equal(state.audioFilters.nightcore, true);
  await state.setAudioFilters(["bassboost", "nightcore"]); assert.equal(starts, 1);
  await state.setAudioFilters([]); assert.equal(starts, 2);
});
