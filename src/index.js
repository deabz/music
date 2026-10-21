require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const play = require("play-dl");
const ytdlp = require("youtube-dl-exec");
const {
  buildHelpEmbed,
  buildNowPlayingEmbed,
  buildPlaybackEmbed,
  buildQueueComponents,
  buildQueueEmbed,
  buildStatsEmbed,
  formatDuration,
  QUEUE_PAGE_SIZE,
  commandAliases,
  commands,
  parsePrefixCommand,
  requesterLabel
} = require("./commands");
const { createHealthServer } = require("./health-server");
const { healthPage } = require("./health-page");
const { dashboardPage } = require("./dashboard-page");
const { formatYtdlpTime, hasAllowedDuration, resolveSuggestedTrack, searchYouTube, resolvePlaylist, buildGeniusSearchUrl } = require("./music-utils");
const {
  ActivityType,
  Client,
  Collection,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes
} = require("discord.js");
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel
} = require("@discordjs/voice");

const required = ["DISCORD_TOKEN"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

const numberEnv = (key, fallback, minimum, maximum) => {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(value) || value < minimum || value > maximum) return fallback;
  return value;
};

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID || "",
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || "",
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
  voiceChannelId: process.env.VOICE_CHANNEL_ID || "",
  voiceGuildId: process.env.VOICE_GUILD_ID || process.env.GUILD_ID || "",
  autoJoin: process.env.AUTO_JOIN_VOICE !== "false",
  port: numberEnv("PORT", 3000, 1, 65535),
  defaultVolume: numberEnv("DEFAULT_VOLUME", 80, 0, 200),
  dashboardToken: process.env.MUSIC_DASHBOARD_TOKEN || "",
  leaveOnEmpty: process.env.LEAVE_ON_EMPTY === "true",
  emptyTimeout: numberEnv("EMPTY_CHANNEL_TIMEOUT_SECONDS", 300, 5, 86400) * 1000,
  maxQueueSize: numberEnv("MAX_QUEUE_SIZE", 2000, 1, 2000)
};
const startedAt = Date.now();
const musicStateFile = path.resolve(process.env.MUSIC_STATE_FILE || "data/music-state.json");
let musicSaveTimer = null;
let musicSaveChain = Promise.resolve();
let savedMusicStates = {};
let musicStateLoaded = false;

function musicSnapshot(state) {
  return {
    voiceChannelId: state.connection?.joinConfig.channelId || state.savedVoiceChannelId || null,
    current: state.current,
    positionSeconds: state.current
      ? state.resumeOffsetSeconds + (state.resource?.playbackDuration || 0) / 1000
      : 0,
    paused: state.player.state.status === AudioPlayerStatus.Paused || state.pauseOnRestore,
    queue: state.queue,
    loop: state.loop,
    volume: state.volume
  };
}

async function writeMusicState() {
  if (!musicStateLoaded) return;
  const guilds = {
    ...savedMusicStates,
    ...Object.fromEntries([...music].map(([guildId, state]) => [guildId, musicSnapshot(state)]))
  };
  const content = JSON.stringify({ version: 1, guilds }, null, 2);
  await fs.mkdir(path.dirname(musicStateFile), { recursive: true });
  const temporaryFile = `${musicStateFile}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, content, "utf8");
  await fs.rename(temporaryFile, musicStateFile);
}

function scheduleMusicSave() {
  if (!musicStateLoaded) return;
  clearTimeout(musicSaveTimer);
  musicSaveTimer = setTimeout(() => {
    musicSaveChain = musicSaveChain
      .then(writeMusicState)
      .catch(error => console.error(`[persistence] Could not save music state: ${error.message}`));
  }, 1000);
}

async function loadMusicState() {
  try {
    const parsed = JSON.parse(await fs.readFile(musicStateFile, "utf8"));
    if (parsed.version !== 1 || !parsed.guilds || typeof parsed.guilds !== "object" || Array.isArray(parsed.guilds)) {
      throw new Error("Unsupported or invalid music state file format.");
    }
    savedMusicStates = parsed.guilds;
    musicStateLoaded = true;
  } catch (error) {
    if (error.code === "ENOENT") {
      savedMusicStates = {};
      musicStateLoaded = true;
    } else {
      console.error(`[persistence] Could not load music state; leaving the file untouched: ${error.message}`);
      musicStateLoaded = false;
    }
  }
}

class GuildMusic {
  constructor(guild) {
    this.guild = guild;
    this.queue = [];
    this.current = null;
    this.resource = null;
    this.loop = "off";
    this.volume = config.defaultVolume;
    this.resumeOffsetSeconds = 0;
    this.pauseOnRestore = false;
    this.savedVoiceChannelId = null;
    this.autoplayTriedUrls = new Set();
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.connection = null;
    this.streamProcess = null;
    this.filterProcess = null;
    this.emptyTimer = null;
    this.notificationChannelId = null;
    this.playing = false;
    this.totalTracksPlayed = 0;
    this.audioFilters = {
      bassboost: false,
      eightd: false,
      nightcore: false,
      echo: false
    };
    this.player.on(AudioPlayerStatus.Idle, () => this.onTrackEnd());
    this.player.on("stateChange", (_, next) => {
      console.log(`[player:${this.guild.id}] ${next.status}${this.current ? `: ${this.current.title}` : ""}`);
      if (next.status === AudioPlayerStatus.Playing && this.pauseOnRestore) {
        this.pauseOnRestore = false;
        this.player.pause();
      }
      scheduleMusicSave();
    });
    this.player.on("error", error => {
      console.error(`[audio:${this.guild.id}] ${error.message}`);
      const failedTrack = this.current;
      const channel = this.guild.client.channels.cache.get(this.notificationChannelId)
        || this.guild.client.channels.cache.get(this.guild.systemChannelId);
      if (failedTrack) {
        channel?.send(`Could not play **${failedTrack.title}**. Trying the next track.`).catch(sendError => {
          console.error(`[playback:${this.guild.id}] Could not send playback error notice: ${sendError.message}`);
        });
      }
      this.onTrackEnd();
    });
  }

  setAudioFilter(filter, enabled) {
    this.audioFilters[filter] = enabled;
    if (this.playing && this.current) {
      // Capture current position before restarting
      const currentPos = this.resumeOffsetSeconds + (this.resource?.playbackDuration || 0) / 1000;
      const wasPaused = this.player.state.status === AudioPlayerStatus.Paused;
      this.resumeOffsetSeconds = currentPos;
      this.pauseOnRestore = wasPaused;

      // Restart track to apply filter
      this.playNext(null, {
        ...this.current,
        resumeAtSeconds: currentPos
      });
    }
    scheduleMusicSave();
  }

  async connect(channel) {
    if (!channel || !channel.isVoiceBased()) throw new Error("Join a voice channel first.");
    if (this.connection && this.connection.joinConfig.channelId === channel.id) return this.connection;
    if (this.connection) this.connection.destroy();
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });
    const connection = this.connection;
    this.connection.subscribe(this.player);
    this.connection.on("error", error => {
      console.error(`[voice:${this.guild.id}] ${error.stack || error.message}`);
    });
    this.connection.on("stateChange", (previous, next) => {
      console.log(`[voice:${this.guild.id}] ${previous.status} -> ${next.status}`);
      if (next.status === VoiceConnectionStatus.Disconnected) {
        entersState(connection, VoiceConnectionStatus.Signalling, 5000)
          .catch(() => this.connection?.destroy());
      }
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    } catch (error) {
      const status = connection.state.status;
      connection.destroy();
      if (this.connection === connection) this.connection = null;
      console.error(`[voice:${this.guild.id}] Failed to reach Ready (last state: ${status}): ${error.stack || error.message}`);
      const detail = status === VoiceConnectionStatus.Signalling
        ? "Discord's voice gateway disconnected during setup; verify the network can reach Discord voice and try again."
        : "Voice signalling started but the connection handshake did not finish; UDP traffic may be blocked by the network.";
      throw new Error(`Voice connection timed out in state "${status}". ${detail}`);
    }
    this.savedVoiceChannelId = channel.id;
    scheduleMusicSave();
    return connection;
  }

  async add(items, voiceChannel, requesterId, notificationChannel) {
    await this.connect(voiceChannel);
    const tooLong = items.find(track => !hasAllowedDuration(track.duration));
    if (tooLong) {
      throw new Error(`"${tooLong.title}" is longer than 6 minutes or has no verified duration. Tracks must be 6 minutes or shorter.`);
    }
    if (this.queue.length + items.length > config.maxQueueSize) {
      throw new Error(`The queue can contain at most ${config.maxQueueSize} tracks.`);
    }
    this.queue.push(...items.map(track => ({ ...track, requestedById: requesterId })));
    this.autoplayTriedUrls.clear();
    this.notificationChannelId = notificationChannel?.id || null;
    scheduleMusicSave();
    if (!this.playing) {
      this.playNext().catch(error => {
        console.error(`[playback:${this.guild.id}] Could not start queued music: ${error.stack || error.message}`);
      });
    }
  }

  setVolume(percent) {
    this.volume = percent;
    this.resource?.volume?.setVolume(percent / 100);
    scheduleMusicSave();
  }

  async seek(seconds) {
    if (!this.current) throw new Error("Nothing is playing.");
    const maxPosition = Math.max(0, this.current.duration - 2);
    const position = Math.min(seconds, maxPosition);
    const wasPaused = this.player.state.status === AudioPlayerStatus.Paused;
    this.resumeOffsetSeconds = position;
    this.pauseOnRestore = wasPaused;
    await this.playNext(null, { ...this.current, resumeAtSeconds: position });
  }

  adjustVolume(amount) {
    this.setVolume(Math.max(0, Math.min(200, this.volume + amount)));
  }

  moveTrack(from, to) {
    if (from < 0 || from >= this.queue.length || to < 0 || to >= this.queue.length) return false;
    const [track] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, track);
    scheduleMusicSave();
    return true;
  }

  clearQueue() {
    this.queue = [];
    scheduleMusicSave();
  }

  async restore(snapshot, channel) {
    this.loop = ["off", "track", "queue"].includes(snapshot.loop) ? snapshot.loop : "off";
    this.volume = Number.isFinite(snapshot.volume) ? Math.max(0, Math.min(200, snapshot.volume)) : config.defaultVolume;
    this.savedVoiceChannelId = snapshot.voiceChannelId;
    this.queue = Array.isArray(snapshot.queue)
      ? snapshot.queue.filter(track =>
        track && typeof track.url === "string" && hasAllowedDuration(track.duration)
      ).slice(0, config.maxQueueSize)
      : [];
    await this.connect(channel);
    if (snapshot.current && typeof snapshot.current.url === "string" && hasAllowedDuration(snapshot.current.duration)) {
      const track = { ...snapshot.current };
      const position = Number.isFinite(snapshot.positionSeconds) ? Math.max(0, snapshot.positionSeconds) : 0;
      track.resumeAtSeconds = track.duration > 0 ? Math.min(position, Math.max(0, track.duration - 2)) : position;
      const resumeAtSeconds = track.resumeAtSeconds;
      this.queue.unshift(track);
      this.pauseOnRestore = snapshot.paused === true;
      await this.playNext();
      console.log(`[persistence:${this.guild.id}] Resuming ${track.title} at ${Math.floor(resumeAtSeconds)}s.`);
    } else if (this.queue.length) {
      await this.playNext();
    }
    scheduleMusicSave();
  }

  async playNext(endedTrack = null, trackToPlay = null) {
    clearTimeout(this.emptyTimer);
    if (this.streamProcess) this.streamProcess.cancelled = true;
    this.streamProcess?.kill();
    this.streamProcess = null;
    if (this.filterProcess) this.filterProcess.cancelled = true;
    this.filterProcess?.kill();
    this.filterProcess = null;
    this.resource = null;
    let next = trackToPlay || this.queue.shift();
    if (!next && endedTrack) {
      if (!endedTrack.autoSuggested) this.autoplayTriedUrls.clear();
      try {
        next = await resolveSuggestedTrack(
          endedTrack,
          this.autoplayTriedUrls,
          (search, options) => searchYouTube(search, options.limit),
          artworkFrom
        );
        if (next) {
          this.autoplayTriedUrls.add(next.url);
          console.log(`[autoplay:${this.guild.id}] Trying ${next.title} (${next.duration}s).`);
        }
      } catch (error) {
        console.error(`[autoplay:${this.guild.id}] ${error.message}`);
      }
      next = this.queue.shift() || next;
    }
    if (!next) {
      this.current = null;
      this.playing = false;
      updatePresence();
      scheduleMusicSave();
      return;
    }
    if (!next.autoSuggested) this.autoplayTriedUrls.clear();
    this.current = next;

    // CRITICAL FIX: Only set resumeOffsetSeconds from the track if we are NOT restarting the same track
    // (e.g., when called from setAudioFilter or /forward, we've already updated this.resumeOffsetSeconds)
    if (endedTrack !== null || !this.resumeOffsetSeconds) {
      this.resumeOffsetSeconds = Number.isFinite(next.resumeAtSeconds) ? next.resumeAtSeconds : 0;
    }
    delete next.resumeAtSeconds;
    this.playing = true;
    updatePresence();
    if (!trackToPlay) this.totalTracksPlayed++;
    try {
      const audioFilters = [];
      if (this.audioFilters.bassboost) {
        audioFilters.push("bass=g=10");
      }
      if (this.audioFilters.eightd) {
        audioFilters.push("apulsator=hz=0.1");
      }
      if (this.audioFilters.nightcore) {
        audioFilters.push("asetrate=44100*1.2,atempo=1.2");
      }
      if (this.audioFilters.echo) {
        audioFilters.push("aecho=0.8:0.88:60:0.4");
      }

      const streamProcess = ytdlp.exec(next.url, {
        format: "bestaudio",
        output: "-",
        noPlaylist: true,
        noWarnings: true,
        quiet: true,
        ffmpegLocation: require('ffmpeg-static'),
        ...(this.resumeOffsetSeconds > 0
          ? { downloadSections: `*${formatYtdlpTime(this.resumeOffsetSeconds)}-inf` }
          : {})
      });
      this.streamProcess = streamProcess;
      const sourceStream = streamProcess.stdout;
      if (!sourceStream || typeof sourceStream.pipe !== "function") {
        throw new Error("yt-dlp did not provide an audio stream.");
      }
      let stderr = "";
      streamProcess.stderr?.on("data", chunk => {
        stderr = `${stderr}${chunk}`.slice(-2000);
      });
      streamProcess.on("close", (code) => {
        if (this.streamProcess === streamProcess) this.streamProcess = null;
        if (code !== 0 && this.playing) {
          console.warn(`[stream:${this.guild.id}] Process exited with code ${code}. This may cause unexpected idle state.`);
        }
      });
      streamProcess.catch(error => {
        if (streamProcess.cancelled) return;
        const detail = stderr.trim() || error.message;
        console.error(`[stream:${this.guild.id}] ${detail}`);
        if (!sourceStream.destroyed) sourceStream.destroy(error);
      });

      let audioStream = sourceStream;
      let inputType = StreamType.WebmOpus;
      if (audioFilters.length) {
        const filterProcess = spawn(require("ffmpeg-static"), [
          "-hide_banner",
          "-loglevel", "error",
          "-i", "pipe:0",
          "-af", audioFilters.join(","),
          "-f", "s16le",
          "-ar", "48000",
          "-ac", "2",
          "pipe:1"
        ], { stdio: ["pipe", "pipe", "pipe"] });
        this.filterProcess = filterProcess;
        audioStream = filterProcess.stdout;
        inputType = StreamType.Raw;

        let filterError = "";
        filterProcess.stderr.on("data", chunk => {
          filterError = `${filterError}${chunk}`.slice(-2000);
        });
        filterProcess.stdin.on("error", error => {
          if (filterProcess.cancelled || error.code === "EPIPE") return;
          console.error(`[filter:${this.guild.id}] ${error.message}`);
        });
        filterProcess.on("error", error => {
          if (filterProcess.cancelled) return;
          console.error(`[filter:${this.guild.id}] ${filterError.trim() || error.message}`);
          if (!audioStream.destroyed) audioStream.destroy(error);
        });
        filterProcess.on("close", code => {
          if (this.filterProcess === filterProcess) this.filterProcess = null;
          if (filterProcess.cancelled || code === 0 || !this.playing) return;
          const error = new Error(filterError.trim() || `FFmpeg exited with code ${code}.`);
          console.error(`[filter:${this.guild.id}] ${error.message}`);
          if (!audioStream.destroyed) audioStream.destroy(error);
        });
        sourceStream.on("error", error => {
          if (!filterProcess.stdin.destroyed) filterProcess.stdin.destroy();
          if (!audioStream.destroyed) audioStream.destroy(error);
        });
        sourceStream.pipe(filterProcess.stdin);
      }

      const resource = createAudioResource(audioStream, {
        inputType,
        inlineVolume: true
      });
      this.resource = resource;
      resource.volume.setVolume(this.volume / 100);
      console.log(`[stream:${this.guild.id}] Starting ${next.title}`);
      this.player.play(resource);
      scheduleMusicSave();
    } catch (error) {
      console.error(`[stream:${this.guild.id}] ${error.message}`);
      scheduleMusicSave();
      await this.playNext(next);
    }
  }

  async onTrackEnd() {
    if (!this.current) return;
    const endedTrack = this.current;
    this.current = null;
    if (this.loop === "track") this.queue.unshift(endedTrack);
    else if (this.loop === "queue") this.queue.push(endedTrack);
    await this.playNext(endedTrack);
  }

  stop() {
    this.queue = [];
    this.current = null;
    this.resource = null;
    this.playing = false;
    this.resumeOffsetSeconds = 0;
    updatePresence();
    if (this.streamProcess) this.streamProcess.cancelled = true;
    this.streamProcess?.kill();
    this.streamProcess = null;
    if (this.filterProcess) this.filterProcess.cancelled = true;
    this.filterProcess?.kill();
    this.filterProcess = null;
    this.player.stop(true);
    scheduleMusicSave();
  }

  async pausePlayback(reason) {
    if (!this.playing) return false;
    this.player.pause();
    scheduleMusicSave();
    return true;
  }

  async resumePlayback(reason) {
    if (!this.playing || this.player.state.status !== AudioPlayerStatus.Paused) return false;
    this.player.unpause();
    scheduleMusicSave();
    return true;
  }

  shuffle() {
    for (let index = this.queue.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [this.queue[index], this.queue[other]] = [this.queue[other], this.queue[index]];
    }
    scheduleMusicSave();
    return this.queue.length;
  }

  scheduleEmptyDisconnect() {
    if (!config.leaveOnEmpty) return;
    clearTimeout(this.emptyTimer);
    this.emptyTimer = setTimeout(() => this.disconnect(), config.emptyTimeout);
  }

  disconnect() {
    clearTimeout(this.emptyTimer);
    this.stop();
    this.connection?.destroy();
    this.connection = null;
    this.savedVoiceChannelId = null;
    scheduleMusicSave();
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
const music = new Collection();
const liveNowPlaying = new Map();
setInterval(() => {
  if ([...music.values()].some(state => state.current)) scheduleMusicSave();
}, 5000).unref();
function updatePresence() {
  if (!client.isReady()) return;
  const active = [...music.values()].find(state => state.playing && state.current);
  const activity = active
    ? active.current.title.slice(0, 128)
    : "'play";
  client.user.setPresence({
    status: "dnd",
    activities: [{ name: activity, type: ActivityType.Listening }]
  });
}

const getMusic = guild => {
  if (!music.has(guild.id)) music.set(guild.id, new GuildMusic(guild));
  return music.get(guild.id);
};
const reply = (interaction, content) => interaction.reply(
  typeof content === "string" ? { content } : content
).catch(() => {});
const trackLine = (track, index) => `${index ? `${index}. ` : ""}**${track.title}** — ${track.author}`;
const formatUptime = milliseconds => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds % 86400 / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    minutes ? `${minutes}m` : null,
    `${seconds}s`
  ].filter(Boolean).join(" ");
};
const artworkFrom = thumbnails => Array.isArray(thumbnails)
  ? [...thumbnails].reverse().find(thumbnail => thumbnail?.url)?.url
  : undefined;

async function replyWithQueue(context, state) {
  let page = 0;
  const queuePayload = () => ({
    embeds: [buildQueueEmbed({
      current: state.current,
      queue: state.queue,
      playbackStatus: state.player.state.status,
      page
    })],
    components: buildQueueComponents({ current: state.current, queue: state.queue, page }),
    allowedMentions: { parse: [] }
  });

  let message;
  if (context.isPrefixCommand) {
    message = await context.reply(queuePayload());
  } else {
    await context.reply(queuePayload());
    message = await context.fetchReply();
  }
  const collector = message.createMessageComponentCollector({
    time: 120_000,
    filter: component => component.customId === "queue:previous" || component.customId === "queue:next"
  });

  collector.on("collect", async component => {
    if (component.user.id !== context.user.id) {
      await component.reply({ content: "Run `'q` yourself to control these pages.", ephemeral: true });
      return;
    }
    page += component.customId === "queue:next" ? 1 : -1;
    const pageCount = Math.max(1, Math.ceil((state.queue.length + (state.current ? 1 : 0)) / 10));
    page = Math.max(0, Math.min(page, pageCount - 1));
    await component.update(queuePayload());
  });

  collector.on("end", () => {
    message.edit({ components: [] }).catch(error => {
      console.error(`[queue:${context.guild.id}] Could not remove expired page buttons: ${error.message}`);
    });
  });

  return message;
}

function liveNowPlayingEmbed(state, options, track = state.current) {
  const playerStatus = state.player.state.status;
  const playbackStatus = playerStatus === AudioPlayerStatus.Idle || playerStatus === AudioPlayerStatus.Buffering
    ? "Starting playback"
    : playerStatus;
  return buildNowPlayingEmbed({
    track,
    elapsedSeconds: Math.floor(state.resumeOffsetSeconds + (state.resource?.playbackDuration || 0) / 1000),
    status: playbackStatus,
    ...options
  });
}

function stopLiveNowPlaying(channelId) {
  const entry = liveNowPlaying.get(channelId);
  if (!entry) return;
  clearTimeout(entry.timer);
  liveNowPlaying.delete(channelId);
}

function scheduleLiveNowPlaying(channelId, entry) {
  entry.timer = setTimeout(async () => {
    if (liveNowPlaying.get(channelId) !== entry) return;
    try {
      await entry.message.edit({ embeds: [liveNowPlayingEmbed(entry.state, entry.options)] });
    } catch (error) {
      console.error(`[nowplaying:${channelId}] Could not update live message: ${error.message}`);
      stopLiveNowPlaying(channelId);
      return;
    }
    if (!entry.state.current) {
      stopLiveNowPlaying(channelId);
      return;
    }
    scheduleLiveNowPlaying(channelId, entry);
  }, 1000);
}

async function postLiveNowPlaying(context, state, options = {}) {
  const { startingTrack, ...liveOptions } = options;
  const channelId = context.channel.id;
  const previous = liveNowPlaying.get(channelId);
  if (previous) {
    stopLiveNowPlaying(channelId);
    try {
      await previous.message.delete();
    } catch (error) {
      console.error(`[nowplaying:${channelId}] Could not replace prior live message: ${error.message}`);
    }
  }

  if (!state.current) return context.reply("Nothing is playing.");
  const payload = { embeds: [liveNowPlayingEmbed(state, liveOptions, startingTrack)] };
  let message;
  if (context.isPrefixCommand) {
    message = context.deferred
      ? await context.editReply(payload)
      : await context.reply(payload);
  } else {
    if (context.deferred) await context.editReply(payload);
    else await context.reply(payload);
    message = await context.fetchReply();
  }

  const entry = { message, state, options: liveOptions, timer: null };
  liveNowPlaying.set(channelId, entry);
  scheduleLiveNowPlaying(channelId, entry);
  return message;
}

async function spotifyToken() {
  if (!config.spotifyClientId || !config.spotifyClientSecret) {
    throw new Error("Spotify support needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.");
  }
  const auth = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error("Spotify authentication failed. Check your Spotify API credentials.");
  return (await response.json()).access_token;
}

async function limitConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function spotifyItems(url) {
  const token = await spotifyToken();
  const match = url.match(/open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error("That Spotify link is not a supported track, album, or playlist.");
  const [, type, id] = match;
  const endpoint = type === "track" ? `tracks/${id}` : `${type}s/${id}/tracks?limit=100`;
  const headers = { Authorization: `Bearer ${token}` };
  let tracks = [];
  if (type === "track") {
    const response = await fetch(`https://api.spotify.com/v1/${endpoint}`, { headers });
    if (!response.ok) throw new Error("Spotify could not provide metadata for that link.");
    tracks = [await response.json()];
  } else {
    let next = `https://api.spotify.com/v1/${endpoint}`;
    while (next) {
      const response = await fetch(next, { headers });
      if (!response.ok) throw new Error("Spotify could not provide metadata for that link.");
      const data = await response.json();
      tracks.push(...(data.items || []).map(item => item.track || item).filter(Boolean));
      if (tracks.length > config.maxQueueSize) {
        throw new Error(`That Spotify playlist or album exceeds the ${config.maxQueueSize}-track queue limit. Increase MAX_QUEUE_SIZE to load the whole release.`);
      }
      next = data.next;
    }
  }
  return tracks
    .filter(track => hasAllowedDuration(track.duration_ms ? track.duration_ms / 1000 : NaN))
    .map(track => ({
    title: track.name,
    author: track.artists.map(artist => artist.name).join(", "),
    duration: track.duration_ms ? Math.floor(track.duration_ms / 1000) : null,
    thumbnail: track.album?.images?.[0]?.url,
    search: `${track.name} ${track.artists[0]?.name || ""} audio`
  }));
}

async function resolveQuery(query, state = null) {
  if (/open\.spotify\.com\//i.test(query)) {
    const spotifyTracks = await spotifyItems(query);
    if (!spotifyTracks.length) {
      throw new Error("No tracks 6 minutes or shorter were found in that Spotify release.");
    }

    if (!state) {
      // Legacy support: return the list if no state is provided
      const CONCURRENCY_LIMIT = 45;
      const resolvedResults = await limitConcurrency(spotifyTracks, CONCURRENCY_LIMIT, async (track, index) => {
        const results = await searchYouTube(track.search, 10);
        const match = results.find(result => hasAllowedDuration(result.durationInSec) && result.url);
        if (match) {
          return {
            url: match.url,
            title: track.title,
            author: track.author,
            duration: match.durationInSec,
            thumbnail: track.thumbnail || artworkFrom(match.thumbnails)
          };
        }
        return null;
      });
      return resolvedResults.filter(item => item !== null);
    }

    // INSTANT MODE: Push to queue in background
    const CONCURRENCY_LIMIT = 3;
    (async () => {
      await limitConcurrency(spotifyTracks, CONCURRENCY_LIMIT, async (track, index) => {
        try {
          const results = await searchYouTube(track.search, 10);
          const match = results.find(result => hasAllowedDuration(result.durationInSec) && result.url);
          if (match) {
            const resolvedTrack = {
              url: match.url,
              title: track.title,
              author: track.author,
              duration: match.durationInSec,
              thumbnail: track.thumbnail || artworkFrom(match.thumbnails),
              requestedById: "system" // Handled by the caller usually, but for background we mark it
            };
            // Add directly to queue without calling state.add (to avoid repeated connect calls)
            state.queue.push(resolvedTrack);
            scheduleMusicSave();

            if (!state.playing) {
              state.playNext().catch(e => console.error(`[background-play] ${e.message}`));
            }
          }
          console.log(`[Spotify Resolve] Processed ${index + 1}/${spotifyTracks.length}: ${track.title}`);
        } catch (e) {
          console.error(`[Spotify Resolve] Error on track ${index}: ${e.message}`);
        }
      });
      console.log(`[Spotify Resolve] Finished adding playlist to queue.`);
    })();

    return []; // Return empty to signal background processing
  }

  // Non-spotify queries still return normally for immediate play
  const urlType = play.yt_validate(query);
  if (urlType === "video") {
    const info = await play.video_basic_info(query);
    if (!hasAllowedDuration(info.video_details.durationInSec)) {
      throw new Error("That track is longer than 6 minutes or has no verified duration. Tracks must be 6 minutes or shorter.");
    }
    return [{
      url: query,
      title: info.video_details.title,
      author: info.video_details.channel?.name || "YouTube",
      duration: info.video_details.durationInSec,
      thumbnail: artworkFrom(info.video_details.thumbnails)
    }];
  }
  const results = await searchYouTube(query, 10);
  const match = results.find(result => hasAllowedDuration(result.durationInSec) && result.url);
  if (!match) throw new Error("No YouTube results 6 minutes or shorter were found.");
  return [{
    url: match.url,
    title: match.title,
    author: match.channel?.name || "YouTube",
    duration: match.durationInSec,
    thumbnail: artworkFrom(match.thumbnails)
  }];
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.token);
  const route = config.guildId ? Routes.applicationGuildCommands(client.user.id, config.guildId) : Routes.applicationCommands(client.user.id);
  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} slash commands ${config.guildId ? `in ${config.guildId}` : "globally"}.`);
}

client.once(Events.ClientReady, async ready => {
  console.log(`Logged in as ${ready.user.tag}`);
  updatePresence();
  await registerCommands();
  await loadMusicState();
  for (const [guildId, snapshot] of Object.entries(savedMusicStates)) {
    if (typeof snapshot.voiceChannelId !== "string") continue;
    const guild = await ready.guilds.fetch(guildId).catch(error => {
      console.error(`[persistence:${guildId}] Could not load guild: ${error.message}`);
      return null;
    });
    if (!guild) continue;
    const channel = await guild.channels.fetch(snapshot.voiceChannelId).catch(error => {
      console.error(`[persistence:${guildId}] Could not load saved voice channel: ${error.message}`);
      return null;
    });
    if (!channel?.isVoiceBased()) {
      console.error(`[persistence:${guildId}] Saved voice channel is unavailable or is not a voice channel.`);
      continue;
    }
    try {
      await getMusic(guild).restore(snapshot, channel);
    } catch (error) {
      console.error(`[persistence:${guildId}] Could not restore music state: ${error.message}`);
    }
  }
  if (config.autoJoin && config.voiceChannelId && config.voiceGuildId) {
    const guild = await ready.guilds.fetch(config.voiceGuildId).catch(() => null);
    const channel = await guild?.channels.fetch(config.voiceChannelId).catch(() => null);
    if (channel?.isVoiceBased() && !music.get(guild.id)?.connection) {
      try {
        await getMusic(guild).connect(channel);
        console.log(`Connected deafened to ${channel.name}.`);
      } catch (error) {
        console.error(`[24/7] ${error.message}`);
      }
    }
  }
});

const handleCommand = async interaction => {
  if (!interaction.guild) return;
  if (interaction.commandName === "help") {
    const category = interaction.options.getString("category") || "all";
    return interaction.reply({
      embeds: [buildHelpEmbed(category)]
    });
  }
  if (interaction.commandName === "ping") {
    return reply(interaction, `Pong! Gateway latency: ${Math.max(0, Math.round(client.ws.ping))} ms.`);
  }
  if (interaction.commandName === "uptime") {
    return reply(interaction, `Online for ${formatUptime(Date.now() - startedAt)}.`);
  }

  const state = getMusic(interaction.guild);
  try {
    if (interaction.commandName === "bassboost") {
      const enabled = !state.audioFilters.bassboost;
      state.setAudioFilter("bassboost", enabled);
      return reply(interaction, `Bass boost is now ${enabled ? "enabled" : "disabled"}.`);
    }
    if (interaction.commandName === "eightd") {
      const enabled = !state.audioFilters.eightd;
      state.setAudioFilter("eightd", enabled);
      return reply(interaction, `8D audio is now ${enabled ? "enabled" : "disabled"}.`);
    }
    if (interaction.commandName === "nightcore") {
      const enabled = !state.audioFilters.nightcore;
      state.setAudioFilter("nightcore", enabled);
      return reply(interaction, `Nightcore is now ${enabled ? "enabled" : "disabled"}.`);
    }
    if (interaction.commandName === "echo") {
      const enabled = !state.audioFilters.echo;
      state.setAudioFilter("echo", enabled);
      return reply(interaction, `Echo is now ${enabled ? "enabled" : "disabled"}.`);
    }
    if (interaction.commandName === "play") {
      const memberChannel = interaction.member.voice?.channel;
      if (!memberChannel) return reply(interaction, "Join a voice channel first.");
      await interaction.deferReply();

      // Resolve tracks in the background so we don't block the interaction
      // and we can respond to the user immediately.
      const query = interaction.options.getString("query", true);

      // We use a non-blocking wrapper to handle the resolution
      (async () => {
        try {
          const tracks = await resolveQuery(query);
          const wasPlaying = state.playing && state.current;
          await state.add(tracks, memberChannel, interaction.user.id, interaction.channel);

          return postLiveNowPlaying(interaction, state, {
            title: "Added to the queue",
            startingTrack: wasPlaying ? state.current : tracks[0],
            queuedSummary: tracks.length === 1
              ? tracks[0].title
              : `${tracks.length} tracks, starting with ${tracks[0].title}`
          });
        } catch (error) {
          console.error(`[command:play] Resolution error: ${error.message}`);
          return interaction.editReply({ content: error.message });
        }
      })();

      return interaction.editReply("Searching for tracks... I'll let you know when they're added!");
    }
    if (interaction.commandName === "set-notification-channel") {
      let channel;
      if (interaction.isPrefixCommand || interaction.options === undefined || typeof interaction.options.getChannel !== "function") {
        let channelId = interaction.options?.getString("channel");
        if (!channelId) return reply(interaction, "Please provide a channel ID or mention a channel.");

        // Handle mentions like <#1234567890>
        const mentionMatch = channelId.match(/<#(\d+)>/);
        if (mentionMatch) channelId = mentionMatch[1];

        channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
      } else {
        channel = interaction.options.getChannel("channel", true);
      }

      if (!channel) return reply(interaction, "Invalid channel provided.");
      if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
        return reply(interaction, `I don't have permission to send messages in ${channel}. Please check my permissions.`);
      }
      state.notificationChannelId = channel.id;
      scheduleMusicSave();
      return reply(interaction, `Notification channel set to ${channel}.`);
    }
    if (interaction.commandName === "join") {
      await interaction.deferReply();
      await state.connect(interaction.member.voice?.channel);
      return interaction.editReply("Connected to your voice channel.");
    }
    if (interaction.commandName === "247") {
      if (!config.voiceChannelId || !config.voiceGuildId) return reply(interaction, "Set VOICE_CHANNEL_ID and VOICE_GUILD_ID in .env first.");
      await interaction.deferReply();
      const channel = await interaction.guild.channels.fetch(config.voiceChannelId);
      await state.connect(channel);
      return interaction.editReply("Connected to the configured 24/7 voice channel.");
    }
    if (interaction.commandName === "pause") {
      state.player.pause();
      return interaction.reply({
        embeds: [buildPlaybackEmbed({ user: interaction.user, title: "Playback paused", track: state.current })]
      });
    }
    if (interaction.commandName === "resume") {
      state.player.unpause();
      return interaction.reply({
        embeds: [buildPlaybackEmbed({ user: interaction.user, title: "Playback resumed", track: state.current })]
      });
    }
    if (interaction.commandName === "pause-track") {
      state.player.pause();
      return interaction.reply({
        embeds: [buildPlaybackEmbed({ user: interaction.user, title: "Playback paused", track: state.current })]
      });
    }
    if (interaction.commandName === "resume-track") {
      state.player.unpause();
      return interaction.reply({
        embeds: [buildPlaybackEmbed({ user: interaction.user, title: "Playback resumed", track: state.current })]
      });
    }
    if (interaction.commandName === "skip") {
      state.player.stop(); return reply(interaction, "Skipped the current track.");
    }
    if (interaction.commandName === "stop") {
      state.stop(); return reply(interaction, "Playback stopped and the queue was cleared.");
    }
    if (interaction.commandName === "leave") {
      state.disconnect(); return reply(interaction, "Disconnected from voice.");
    }
    if (interaction.commandName === "queue") {
      return replyWithQueue(interaction, state);
    }
    if (interaction.commandName === "shuffle") {
      const count = state.shuffle();
      return reply(interaction, count > 1 ? `Shuffled ${count} queued tracks.` : "Add at least two tracks to the queue to shuffle them.");
    }
    if (interaction.commandName === "nowplaying") {
      if (!state.current) return reply(interaction, "Nothing is playing.");
      return postLiveNowPlaying(interaction, state, {
        requester: requesterLabel(state.current)
      });
    }
    if (interaction.commandName === "stats") {
      const { buildStatsEmbed } = require("./commands");
      return interaction.reply({
        embeds: [buildStatsEmbed(state, formatUptime(Date.now() - startedAt))]
      });
    }
    if (interaction.commandName === "volume") {
      state.setVolume(interaction.options.getInteger("percent", true));
      return reply(interaction, `Volume set to ${state.volume}%.`);
    }
    if (interaction.commandName === "volup") {
      state.adjustVolume(10);
      return reply(interaction, `Volume increased to ${state.volume}%.`);
    }
    if (interaction.commandName === "voldown") {
      state.adjustVolume(-10);
      return reply(interaction, `Volume decreased to ${state.volume}%.`);
    }
    if (interaction.commandName === "loop") {
      state.loop = interaction.options.getString("mode", true);
      scheduleMusicSave();
      return reply(interaction, `Repeat mode set to ${state.loop}.`);
    }
    if (interaction.commandName === "remove") {
      const position = interaction.options.getInteger("position", true);
      if (position < 1 || position > state.queue.length) {
        return reply(interaction, `Invalid position. The queue has ${state.queue.length} songs.`);
      }
      const removed = state.queue.splice(position - 1, 1)[0];
      scheduleMusicSave();
      return reply(interaction, `Removed **${removed.title}** from the queue.`);
    }
    if (interaction.commandName === "move") {
      const from = interaction.options.getInteger("from", true) - 1;
      const to = interaction.options.getInteger("to", true) - 1;
      if (state.moveTrack(from, to)) {
        return reply(interaction, `Moved track from #${from + 1} to #${to + 1}.`);
      } else {
        return reply(interaction, "Invalid positions provided.");
      }
    }
    if (interaction.commandName === "clear") {
      state.clearQueue();
      return reply(interaction, "The queue has been cleared.");
    }
    if (interaction.commandName === "lyrics") {
      if (!state.current) return reply(interaction, "No song is playing right now.");
      const track = state.current;
      const geniusUrl = buildGeniusSearchUrl(track.title, track.author);
      const embed = new EmbedBuilder()
        .setTitle(track.title)
        .setURL(geniusUrl)
        .setAuthor({ name: track.author })
        .setDescription(`[Open lyrics on Genius](${geniusUrl})`)
        .setColor("#0099ff");

      return reply(interaction, { embeds: [embed] });
    }
    if (interaction.commandName === "search") {
      const query = interaction.options.getString("query", true);
      await interaction.deferReply();
      try {
        const results = await searchYouTube(query, 5);
        if (!results.length) return interaction.editReply("No results found for your search.");

        const { ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require("discord.js");
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`search_select:${interaction.user.id}`)
          .setPlaceholder("Select a song to add to the queue")
          .addOptions(results.map((r, i) => ({
            label: r.title.slice(0, 100),
            description: `${r.channel?.name || "Unknown"} · ${formatDuration(r.durationInSec)}`,
            value: JSON.stringify({ url: r.url, title: r.title, author: r.channel?.name || "Unknown", duration: r.durationInSec, thumbnail: r.thumbnails?.[0]?.url })
          })));

        const response = await interaction.editReply({
          content: `Top 5 results for **${query}**:`,
          components: [new ActionRowBuilder().addComponents(menu)]
        });

        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.StringSelect,
          time: 60_000
        });

        collector.on("collect", async i => {
          if (i.user.id !== interaction.user.id) return i.reply({ content: "This menu is not for you!", ephemeral: true });
          const track = JSON.parse(i.values[0]);
          const memberChannel = i.member.voice?.channel;
          if (!memberChannel) return i.reply({ content: "Join a voice channel first.", ephemeral: true });

          await state.add([track], memberChannel, i.user.id, i.channel);
          await i.update({ content: `Added **${track.title}** to the queue!`, components: [] });
        });

        collector.on("end", () => {
          interaction.editReply({ components: [] }).catch(() => {});
        });
      } catch (error) {
        console.error(`[command:search] ${error.stack || error.message}`);
        return interaction.editReply("An error occurred while searching.");
      }
    }
  } catch (error) {
    console.error(`[command:${interaction.commandName}] ${error.stack || error.message}`);
    const errorMessage = error.message || "Something went wrong.";
    if (interaction.deferred) await interaction.editReply(errorMessage).catch(() => {});
    else await reply(interaction, errorMessage);
  }
};

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guildId = newState.guild.id;
  const state = getMusic(newState.guild);
  const channel = newState.channel;

  if (!state.connection) return;
  const voiceChannel = state.connection.joinConfig.channelId;
  if (channel?.id !== voiceChannel) return;

  const members = newState.guild.members.cache.filter(m => m.voice.channelId === voiceChannel && !m.user.bot);

  if (members.size === 0 && state.playing) {
    await state.pausePlayback("empty");
    const textChannel = state.notificationChannelId
      ? newState.guild.channels.cache.get(state.notificationChannelId)
      : newState.guild.systemChannel;
    textChannel?.send("Music paused because no one is in the voice channel. ⏸️").catch(() => {});
  } else if (members.size > 0 && state.player.state.status === AudioPlayerStatus.Paused && state.playing) {
    await state.resumePlayback("member joined");
    const textChannel = state.notificationChannelId
      ? newState.guild.channels.cache.get(state.notificationChannelId)
      : newState.guild.systemChannel;
    textChannel?.send("Music resumed because someone joined the voice channel! 🔊").catch(() => {});
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction);
});

client.on(Events.MessageCreate, async message => {
  if (!message.guild || !message.member || message.author.bot) return;
  const parsed = parsePrefixCommand(message.content);
  if (!parsed) return;

  const command = commands.find(item => item.name === parsed.name);
  if (!command) return;
  if (parsed.name === "247" && !message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply({
      content: "You need the Manage Server permission to use this command.",
      allowedMentions: { repliedUser: false }
    });
    return;
  }

  const options = command.options || [];
  const argument = parsed.args;
  const sendMessage = content => message.reply({
    content,
    allowedMentions: { repliedUser: false }
  });

  if (options.some(option => option.required) && !argument) {
    await sendMessage(`Usage: \`'${parsed.name} ${options.map(option => `<${option.name}>`).join(" ")}\``);
    return;
  }
  if (parsed.name === "volume" && !/^(?:[0-9]|[1-9][0-9]|1[0-9]{2}|200)$/.test(argument)) {
    await sendMessage("Volume must be a whole number from 0 to 200. Example: `'volume 80`.");
    return;
  }
  if (parsed.name === "loop" && !["off", "track", "queue"].includes(argument.toLowerCase())) {
    await sendMessage("Repeat mode must be `off`, `track`, or `queue`. Example: `'loop queue`.");
    return;
  }
  if (parsed.name === "help" && argument && !["all", "guide", "playback", "queue", "voice", "settings"].includes(argument.toLowerCase())) {
    await sendMessage("Choose a help category: `all`, `guide`, `playback`, `queue`, `voice`, or `settings`.");
    return;
  }
  if (!options.length && argument) {
    await sendMessage(`This command takes no arguments. Use \`'${parsed.name}\`.`);
    return;
  }

  let deferredMessage = null;
  const prefixContext = {
    isPrefixCommand: true,
    commandName: parsed.name,
    channel: message.channel,
    guild: message.guild,
    member: message.member,
    user: message.author,
    deferred: false,
    options: {
      getString(name) {
        if (name === "query" && parsed.name === "play") return argument;
        if (name === "category" && parsed.name === "help") return argument || null;
        if (name === "mode" && parsed.name === "loop") return argument;
        if (name === "channel" && parsed.name === "set-notification-channel") return argument;
        return null;
      },
      getInteger(name) {
        return name === "percent" && parsed.name === "volume" ? Number(argument) : null;
      }
    },
    async reply(payload) {
      const messageOptions = typeof payload === "string" ? { content: payload } : { ...payload };
      delete messageOptions.flags;
      return message.reply({
        ...messageOptions,
        allowedMentions: { ...messageOptions.allowedMentions, parse: [], repliedUser: false }
      });
    },
    async deferReply() {
      this.deferred = true;
      deferredMessage = await message.reply({
        content: "Working on your request.",
        allowedMentions: { repliedUser: false }
      });
    },
    async editReply(content) {
      return deferredMessage.edit(content);
    }
  };

  await handleCommand(prefixContext);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guildId = newState.guild.id;
  const state = getMusic(newState.guild);
  const channel = newState.channel;

  if (!state.connection) return;
  const voiceChannel = state.connection.joinConfig.channelId;
  if (channel?.id !== voiceChannel) return;

  const members = newState.guild.members.cache.filter(m => m.voice.channelId === voiceChannel && !m.user.bot);

  if (members.size === 0 && state.playing) {
    await state.pausePlayback("empty");
    const textChannel = state.notificationChannelId
      ? newState.guild.channels.cache.get(state.notificationChannelId)
      : newState.guild.systemChannel;
    textChannel?.send("Music paused because no one is in the voice channel. ⏸️").catch(() => {});
  } else if (members.size > 0 && state.player.state.status === AudioPlayerStatus.Paused && state.playing) {
    await state.resumePlayback("member joined");
    const textChannel = state.notificationChannelId
      ? newState.guild.channels.cache.get(state.notificationChannelId)
      : newState.guild.systemChannel;
    textChannel?.send("Music resumed because someone joined the voice channel! 🔊").catch(() => {});
  }
});

function dashboardError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function dashboardGuildSnapshot(guild) {
  const state = music.get(guild.id);
  const current = state?.current;
  const dashboardRequesterLabel = track => {
    const requesterId = track?.requestedById;
    if (requesterId === "dashboard") return "Dashboard";
    if (!requesterId || requesterId === "system") return "Autoplay";
    const member = guild.members.cache.get(requesterId);
    return member?.displayName || member?.user.username || "Discord user";
  };
  const positionSeconds = current
    ? Math.floor(state.resumeOffsetSeconds + (state.resource?.playbackDuration || 0) / 1000)
    : 0;
  const channelId = state?.connection?.joinConfig.channelId || null;
  return {
    id: guild.id,
    name: guild.name,
    connected: Boolean(state?.connection),
    voiceChannelId: channelId,
    voiceChannels: guild.channels.cache
      .filter(channel => channel.isVoiceBased())
      .map(channel => ({ id: channel.id, name: channel.name }))
      .sort((first, second) => first.name.localeCompare(second.name)),
    current: current ? {
      title: current.title,
      artist: current.author,
      thumbnail: current.thumbnail || null,
      durationSeconds: current.duration,
      positionSeconds,
      requestedBy: dashboardRequesterLabel(current),
      status: state.player.state.status === AudioPlayerStatus.Paused ? "paused" : "playing"
    } : null,
    queue: state?.queue.map(track => ({
      title: track.title,
      artist: track.author,
      durationSeconds: track.duration,
      requestedBy: dashboardRequesterLabel(track)
    })) || [],
    volume: state?.volume ?? config.defaultVolume,
    loop: state?.loop || "off"
  };
}

async function controlDashboard(payload) {
  const { guildId, action } = payload;
  if (typeof guildId !== "string" || !/^\d{17,20}$/.test(guildId)) {
    throw dashboardError("Choose a valid Discord server.");
  }
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw dashboardError("The bot is not connected to that server.", 404);
  if (typeof action !== "string") throw dashboardError("Choose a dashboard action.");
  const state = getMusic(guild);
  const getVoiceChannel = async channelId => {
    if (typeof channelId !== "string" || !/^\d{17,20}$/.test(channelId)) {
      throw dashboardError("Choose a valid voice channel.");
    }
    const channel = guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isVoiceBased()) throw dashboardError("That voice channel is unavailable.");
    return channel;
  };

  if (action === "pause") {
    if (!await state.pausePlayback("dashboard")) throw dashboardError("Nothing is playing.");
  } else if (action === "resume") {
    if (!await state.resumePlayback("dashboard")) throw dashboardError("Playback is not paused.");
  } else if (action === "skip") {
    if (!state.current) throw dashboardError("Nothing is playing.");
    state.player.stop();
  } else if (action === "stop") {
    state.stop();
  } else if (action === "seek") {
    if (!Number.isFinite(payload.seconds) || payload.seconds < 0 || payload.seconds > state.current?.duration) {
      throw dashboardError("Choose a position within the current song.");
    }
    await state.seek(payload.seconds);
  } else if (action === "volume") {
    if (!Number.isInteger(payload.volume) || payload.volume < 0 || payload.volume > 200) {
      throw dashboardError("Volume must be a whole number from 0 to 200.");
    }
    state.setVolume(payload.volume);
  } else if (action === "loop") {
    if (!["off", "track", "queue"].includes(payload.mode)) {
      throw dashboardError("Repeat mode must be off, track, or queue.");
    }
    state.loop = payload.mode;
    scheduleMusicSave();
  } else if (action === "add") {
    if (typeof payload.query !== "string" || !payload.query.trim() || payload.query.length > 500) {
      throw dashboardError("Enter a song name or a YouTube/Spotify URL (up to 500 characters).");
    }
    const channelId = payload.channelId || state.connection?.joinConfig.channelId;
    const channel = await getVoiceChannel(channelId);
    const tracks = await resolveQuery(payload.query.trim());
    if (!tracks.length) throw dashboardError("No playable tracks were found.");
    await state.add(tracks, channel, "dashboard", null);
  } else if (action === "remove") {
    if (!Number.isInteger(payload.position) || payload.position < 0 || payload.position >= state.queue.length) {
      throw dashboardError("That queue position is no longer available.");
    }
    state.queue.splice(payload.position, 1);
    scheduleMusicSave();
  } else if (action === "move") {
    if (!Number.isInteger(payload.from) || !Number.isInteger(payload.to)
      || !state.moveTrack(payload.from, payload.to)) {
      throw dashboardError("Those queue positions are no longer available.");
    }
  } else if (action === "clear") {
    state.clearQueue();
  } else if (action === "shuffle") {
    state.shuffle();
  } else if (action === "connect") {
    await state.connect(await getVoiceChannel(payload.channelId));
  } else if (action === "disconnect") {
    state.disconnect();
  } else {
    throw dashboardError("That dashboard action is not supported.");
  }

  return dashboardGuildSnapshot(guild);
}

createHealthServer({
  page: healthPage,
  dashboardPage,
  dashboardToken: config.dashboardToken,
  getDashboard() {
    return {
      guilds: [...client.guilds.cache.values()]
        .sort((first, second) => first.name.localeCompare(second.name))
        .map(dashboardGuildSnapshot)
    };
  },
  controlDashboard,
  getStatus() {
    const ready = client.isReady();
    const active = [...music.values()].find(state => state.playing && state.current);
    const track = active?.current;
    return {
      ready,
      serverCount: ready ? client.guilds.cache.size : 0,
      track: track ? {
        title: track.title,
        artist: track.author,
        thumbnail: track.thumbnail || null,
        positionSeconds: Math.floor(active.resumeOffsetSeconds + (active.resource?.playbackDuration || 0) / 1000),
        durationSeconds: track.duration || null,
        status: active.player.state.status === AudioPlayerStatus.Paused ? "paused" : "playing",
        server: active.guild.name
      } : null
    };
  }
}).listen(config.port, () => console.log(`Health website listening on :${config.port}/health`));

async function shutdown() {
  clearTimeout(musicSaveTimer);
  await musicSaveChain;
  await writeMusicState().catch(error => console.error(`[persistence] Could not save state during shutdown: ${error.message}`));
  for (const state of music.values()) {
    if (state.streamProcess) state.streamProcess.cancelled = true;
    state.streamProcess?.kill();
    if (state.filterProcess) state.filterProcess.cancelled = true;
    state.filterProcess?.kill();
    state.connection?.destroy();
  }
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
client.login(config.token);
