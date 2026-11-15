require("dotenv").config();

const { createLyricsController } = require("./lyrics-controller");
const lyrics = createLyricsController({ isReady: () => startupComplete && !shuttingDown });
const storage = require("./storage");
const { FavouritesStore } = require("./favourites");
const favourites = new FavouritesStore();
const { PanelSuggestions } = require("./panel-suggestions");
const { createPlayerPanel, buildPlayConfirmation, formatTrackTitle, short } = require("./player-panel");
const { createPanelInteractionHandler } = require("./panel-interactions");
const { classifyStreamFailure, isExpectedPipeFailure, NATURAL_END_TOLERANCE_SECONDS, streamFailureDiagnostic, streamEndDiagnostic } = require("./playback-errors");
const { logYtdlpVersion } = require("./ytdlp-tools");
const { createAudioPipeline } = require("./audio-pipeline");
const { parseTransitionSettings, shouldFadeIn, TransitionController, NATURAL_HANDOVER_GRACE_MS } = require("./transitions");
const play = require("play-dl");
const { musicAccessError, resolveMemberVoiceChannel } = require("./music-permissions");
const { createSpotifyClient, matchSpotifyTracks } = require("./spotify");
const {
  buildHelpEmbed,
  buildPlaybackEmbed,
  buildQueueComponents,
  buildQueueEmbed,
  buildStatsEmbed,
  formatDuration,
  QUEUE_PAGE_SIZE,
  queuePageCount,
  commands
} = require("./commands");
const { createHealthServer } = require("./health-server");
const { healthPage } = require("./health-page");
const { dashboardPage } = require("./dashboard-page");
const { MAX_TRACK_DURATION_SECONDS, hasAllowedDuration, resolveSuggestedTrack, searchYouTube, resolvePlaylist, prepareYouTubeCookies } = require("./music-utils");
const {
  ActivityType,
  ChannelType,
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  RESTEvents,
  Routes
} = require("discord.js");
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
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

const transitionSettings = parseTransitionSettings(process.env);
const config = {
  transitionMode: transitionSettings.mode,
  transitionSeconds: transitionSettings.seconds,
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
const { playbackPosition } = require("./playback-position");
const { createMentionHandler } = require("./mentions");
const startedAt = Date.now();
let startupComplete = false;
let shuttingDown = false;
let shutdownPromise = null;
let musicSaveTimer = null;
let musicSaveChain = Promise.resolve();
let savedMusicStates = {};
let musicStateLoaded = false;

function musicSnapshot(state) {
  return {
    voiceChannelId: state.connection?.joinConfig.channelId || state.savedVoiceChannelId || null,
    current: state.current,
    positionSeconds: state.current
      ? playbackPosition(state)
      : 0,
    paused: state.player.state.status === AudioPlayerStatus.Paused || state.pauseOnRestore,
    queue: state.queue,
    loop: state.loop,
    volume: state.volume,
    notificationChannelId: state.notificationChannelId,
    panelChannelId: state.panelChannelId || null,
    panelMessageId: state.panelMessageId || null
  };
}

async function writeMusicState(options) {
  if (!musicStateLoaded) {
    if (options?.throwOnError) throw new Error("Music storage has not loaded; retaining old panel.");
    return;
  }
  const guilds = {
    ...savedMusicStates,
    ...Object.fromEntries([...music].map(([guildId, state]) => [guildId, musicSnapshot(state)]))
  };
  await storage.saveGuilds(guilds, options);
}

function scheduleMusicSave() {
  for (const state of music.values()) {
    state.panel?.scheduleUpdate();
    state.transitions?.refresh();
  }
  if (shuttingDown || !musicStateLoaded) return;
  clearTimeout(musicSaveTimer);
  musicSaveTimer = setTimeout(() => {
    musicSaveChain = musicSaveChain
      .then(writeMusicState)
      .catch(error => console.error(`[persistence] Could not save music state: ${error.message}`));
  }, 1000);
}

function persistPanelIdentity() {
  scheduleMusicSave();
  musicSaveChain = musicSaveChain.catch(() => {}).then(() => writeMusicState({ throwOnError: true }));
  return musicSaveChain;
}

async function loadMusicState() {
  musicStateLoaded = false;
  try {
    savedMusicStates = await storage.loadAll();
    musicStateLoaded = true;
  } catch (error) {
    console.error(`[persistence] Could not load music state; leaving stored state untouched and saving disabled: ${error.message}`);
  }
}

class GuildMusic {
  constructor(guild) {
    this.guild = guild;
    this.queue = [];
    this.history = [];
    this.current = null;
    this.resource = null;
    this.loop = "off";
    this.volume = config.defaultVolume;
    this.transitions = new TransitionController(this, { mode: config.transitionMode, seconds: config.transitionSeconds });
    this.resumeOffsetSeconds = 0;
    this.pauseOnRestore = false;
    this.savedVoiceChannelId = null;
    this.autoplayTriedUrls = new Set();
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.connection = null;
    this.activePipeline = null;
    this.prefetch = null;
    this.nextGeneration = 0;
    this.emptyTimer = null;
    this.pausedForEmpty = false;
    this.notificationChannelId = null;
    this.panelChannelId = null;
    this.panelMessageId = null;
    this.panel = createPlayerPanel(this, persistPanelIdentity);
    this.suggestions = new PanelSuggestions(this, { changed: () => this.panel.scheduleUpdate() });
    this.panelSuggestions = null;
    this.playing = false;
    this.totalTracksPlayed = 0;
    this.audioFilters = {
      bassboost: false,
      eightd: false,
      nightcore: false,
      echo: false
    };
    this.player.on(AudioPlayerStatus.Idle, previous => this.onTrackEnd(previous?.resource));
    this.player.on("stateChange", (_, next) => {
      if (next.resource && next.resource !== this.resource) return;
      console.log(`[${new Date().toISOString()}] [player:${this.guild.id}] ${next.status}${this.current ? `: ${this.current.title}` : ""}`);
      if (next.status === AudioPlayerStatus.Playing) {
        if (this.activePipeline && !this.activePipeline.startedAt) this.activePipeline.startedAt = Date.now();
        this.suggestions?.load(this.current);
        this.prepareNext();
      }
      if (next.status === AudioPlayerStatus.Playing && this.pauseOnRestore) {
        this.pauseOnRestore = false;
        this.player.pause();
      }
      scheduleMusicSave();
    });
    this.player.on("error", error => {
      if (error.resource && error.resource !== this.resource) return;
      this.failPlayback(this.current, error);
    });
  }

  setAudioFilter(filter, enabled, onFailure) {
    const selected = new Set(Object.keys(this.audioFilters).filter(name => this.audioFilters[name]));
    if (enabled) selected.add(filter); else selected.delete(filter);
    return this.setAudioFilters([...selected], onFailure);
  }

  async setAudioFilters(selected, onFailure) {
    const names = ["bassboost", "eightd", "nightcore", "echo"];
    if (!Array.isArray(selected) || selected.some(name => !names.includes(name))) throw new Error("Invalid effects selection.");
    const filters = Object.fromEntries(names.map(name => [name, selected.includes(name)]));
    if (names.every(name => Boolean(this.audioFilters[name]) === filters[name])) return;
    if (this.playing && this.current) {
      await this.restartCurrent(filters, playbackPosition(this), onFailure);
    } else { this.invalidateNext(); this.audioFilters = filters; }
    scheduleMusicSave();
  }

  async restartCurrent(filters, position, onFailure, { rollbackOnly = false } = {}) {
    if (this.restartTransaction || this.skipPromise) throw new Error("Please wait; a stream restart is in progress.");
    if (!this.current) throw new Error("Nothing is playing.");
    const operation = this.restartTransaction = {};
    const track = { ...this.current };
    const previous = { ...this.audioFilters };
    const previousPosition = playbackPosition(this);
    const paused = this.player.state.status === AudioPlayerStatus.Paused || this.pauseOnRestore;
    this.restartRecovery = null;
    const attempt = async (selected, start = position) => {
      this.audioFilters = { ...selected };
      this.current = null; // Old Idle cannot advance or fail the replacement.
      this.invalidateNext();
      this.cancelActive();
      this.player.stop?.(true);
      this.pauseOnRestore = paused;
      await this.playNext(null, { ...track, resumeAtSeconds: start }, { recoverable: true });
    };
    try {
      try { await attempt(filters); }
      catch (error) {
        if (this.restartTransaction !== operation) return;
        if (rollbackOnly) { await this.failPlayback(this.current, error); throw error; }
        try { await attempt(previous, previousPosition); }
        catch (rollbackError) { await this.failPlayback(this.current, rollbackError); }
        throw new Error("The stream change could not be applied; previous settings were restored.");
      }
      if (this.restartTransaction === operation && this.current) {
        this.restartRecovery = { track: this.current, previous, position: previousPosition, paused, onFailure };
      }
    } finally {
      if (this.restartTransaction === operation) this.restartTransaction = null;
      scheduleMusicSave();
    }
  }

  async rollbackRestart(error) {
    const recovery = this.restartRecovery;
    if (!recovery || recovery.track !== this.current || this.restartTransaction) return;
    this.restartRecovery = null;
    console.error(`[stream-failure] ${streamFailureDiagnostic(this, this.current, error)}`);
    try {
      this.pauseOnRestore = recovery.paused;
      await this.restartCurrent(recovery.previous, recovery.position, null, { rollbackOnly: true });
      this.restartRecovery = null; // A rollback is never itself rolled back.
    } catch { /* restartCurrent already invokes normal handling if both attempts fail. */ }
    try { await recovery.onFailure?.("The stream change failed; previous audio settings were restored if playback could be recovered."); }
    catch { /* Expired interaction tokens must not affect playback recovery. */ }
  }

  async connect(channel) {
    if (!channel || !channel.isVoiceBased()) throw new Error("Join a voice channel first.");
    while (this.connectPromise) await this.connectPromise.catch(() => {});
    if (shuttingDown) throw new Error("Bot is shutting down.");
    if (this.connection?.state.status === VoiceConnectionStatus.Ready
      && this.connection.joinConfig.channelId === channel.id) return this.connection;
    const generation = this.voiceGeneration || 0;
    const pending = this.openConnection(channel, generation);
    this.connectPromise = pending;
    try { return await pending; }
    finally { if (this.connectPromise === pending) this.connectPromise = null; }
  }

  async openConnection(channel, generation) {
    const previous = this.connection;
    this.connection = null;
    if (previous && previous.state.status !== VoiceConnectionStatus.Destroyed) previous.destroy();
    const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
    this.connection = connection;
    this.savedVoiceChannelId = channel.id;
    connection.subscribe(this.player);
    connection.on("error", error => {
      if (this.connection === connection && generation === (this.voiceGeneration || 0)) {
        console.error(`[stream-failure] ${streamFailureDiagnostic(this, this.current, error, "voice")}`);
      }
    });
    connection.on("stateChange", (before, next) => {
      console.log(`[${new Date().toISOString()}] [voice:${this.guild.id}] ${before.status} -> ${next.status}`);
      if (shuttingDown || this.connection !== connection || this.connectPromise) return;
      if (next.status === VoiceConnectionStatus.Disconnected || next.status === VoiceConnectionStatus.Destroyed) {
        this.recoverVoice(connection).catch(error => console.error(`[voice:${this.guild.id}] Recovery failed: ${error.message}`));
      }
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15000);
      if (generation !== (this.voiceGeneration || 0)) throw new Error("Voice connection was cancelled.");
    } catch (error) {
      if (this.connection === connection) this.connection = null;
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      throw error;
    }
    scheduleMusicSave();
    return connection;
  }

  async recoverVoice(connection) {
    if (shuttingDown || this.recoveryPromise || this.connection !== connection) return;
    const generation = this.voiceGeneration || 0;
    const valid = () => generation === (this.voiceGeneration || 0);
    const task = (async () => {
      const wasPlaying = this.player.state.status === AudioPlayerStatus.Playing;
      if (wasPlaying) await this.pausePlayback("voice recovery");
      try {
        await Promise.any([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
        if (valid() && this.connection === connection) {
          if (wasPlaying) await this.resumePlayback("voice recovery");
          return;
        }
      } catch { /* Rebuild only after normal voice recovery fails. */ }
      if (!valid() || this.connection !== connection) return;
      this.connection = null;
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      const channelId = this.savedVoiceChannelId;
      for (let attempt = 1; attempt <= 2 && valid(); attempt++) {
        try {
          const channel = await this.guild.channels.fetch(channelId);
          if (!valid()) return;
          await this.connect(channel);
          if (valid() && wasPlaying) await this.resumePlayback("voice recovery");
          return;
        } catch (error) { console.error(`[voice:${this.guild.id}] Reconnect ${attempt}/2 failed: ${error.message}`); }
      }
      if (!valid()) return;
      const current = this.current;
      if (current) this.queue.unshift({ ...current, resumeAtSeconds: playbackPosition(this) });
      this.current = null;
      this.playing = false;
      this.invalidateNext();
      this.cancelActive();
      this.player.stop(true);
      updatePresence();
      scheduleMusicSave();
    })();
    this.recoveryPromise = task;
    try { await task; } finally { if (this.recoveryPromise === task) this.recoveryPromise = null; }
  }

  async add(items, voiceChannel, requesterId, notificationChannel) {
    const tooLong = items.find(track => !hasAllowedDuration(track.duration));
    if (tooLong) {
      throw new Error(`"${tooLong.title}" is longer than ${MAX_TRACK_DURATION_SECONDS / 60} minutes or has no verified duration. Tracks must be ${MAX_TRACK_DURATION_SECONDS / 60} minutes or shorter.`);
    }
    if (this.queue.length + items.length > config.maxQueueSize) {
      throw new Error(`The queue can contain at most ${config.maxQueueSize} tracks.`);
    }
    this.invalidateNext();
    await this.connect(voiceChannel);
    if (this.queue.length + items.length > config.maxQueueSize) throw new Error("The queue is full.");
    this.queue.push(...items.map(({ panelInstanceId, ...track }) => ({ ...track, requestedById: requesterId })));
    this.autoplayTriedUrls.clear();
    if (!this.notificationChannelId) this.notificationChannelId = notificationChannel?.id || null;
    if (this.playing) this.prepareNext();
    scheduleMusicSave();
    if (!this.playing) {
      this.playNext().catch(error => {
        console.error(`[playback:${this.guild.id}] Could not start queued music: ${error.stack || error.message}`);
      });
    }
  }

  setVolume(percent) {
    this.volume = percent;
    if (this.transitions) this.transitions.refresh();
    else this.resource?.volume?.setVolume(percent / 100);
    scheduleMusicSave();
  }

  async seek(seconds) {
    if (!this.current) throw new Error("Nothing is playing.");
    const maxPosition = Math.max(0, this.current.duration - 2);
    const position = Math.min(seconds, maxPosition);
    await this.restartCurrent(this.audioFilters, position);
  }

  adjustVolume(amount) {
    this.setVolume(Math.max(0, Math.min(200, this.volume + amount)));
  }

  moveTrack(from, to) {
    if (from < 0 || from >= this.queue.length || to < 0 || to >= this.queue.length) return false;
    const [track] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, track);
    this.queueChanged();
    return true;
  }

  clearQueue() {
    this.queue = [];
    this.queueChanged();
  }

  async restore(snapshot, channel) {
    if (this.restorePromise) return this.restorePromise;
    if (this.restored || this.current) return;
    const pending = this.restoreState(snapshot, channel);
    this.restorePromise = pending;
    try { await pending; this.restored = true; }
    finally { this.restorePromise = null; }
  }

  restorePanel(snapshot) {
    this.panelChannelId = typeof snapshot.panelChannelId === "string" ? snapshot.panelChannelId : null;
    this.panelMessageId = typeof snapshot.panelMessageId === "string" ? snapshot.panelMessageId : null;
  }

  async restoreState(snapshot, channel) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Invalid saved snapshot.");
    this.restorePanel(snapshot);
    this.notificationChannelId = typeof snapshot.notificationChannelId === "string" ? snapshot.notificationChannelId : null;
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

  invalidateNext() {
    this.nextGeneration = (this.nextGeneration || 0) + 1;
    this.cancelPrefetch();
    this.suggestionAbort?.abort();
    this.suggestionAbort = null;
  }

  cancelPrefetch() {
    const prefetch = this.prefetch;
    this.prefetch = null;
    if (prefetch?.job) this.recordStreamEnd(prefetch.job.error ? "error" : "intentional abort", prefetch.job, prefetch.track, null);
    prefetch?.job?.cancel?.();
  }

  queueChanged() {
    this.invalidateNext();
    scheduleMusicSave();
    if (this.current) this.prepareNext(false);
  }

  prepareNext(allowSuggestion = true, sourceTrack = this.current) {
    if (shuttingDown || !sourceTrack) return;
    const track = this.loop === "track" && this.current ? this.current : this.queue[0]
      || (this.loop === "queue" ? this.current : null);
    if (track) {
      if (this.prefetch?.track === track && this.prefetch?.job) return;
      this.cancelPrefetch();
      const job = createAudioPipeline(track, this.audioFilters);
      job.track = track;
      this.prefetch = { track, job };
      job.onFailure = error => {
        this.recordStreamEnd("error", job, track, null);
        console.error(`[stream-failure] ${streamFailureDiagnostic({ ...this, activePipeline: job }, track, error)}`);
      };
      job.onDiagnostic = error => console.error(`[stream-failure] ${streamFailureDiagnostic({ ...this, activePipeline: job }, track, error)}`);
      return;
    }
    if (!allowSuggestion || this.suggestionGeneration === this.nextGeneration) return;
    const generation = this.nextGeneration;
    this.suggestionGeneration = generation;
    const current = sourceTrack;
    if (current.url) this.autoplayTriedUrls.add(current.url);
    while (this.autoplayTriedUrls.size > 50) this.autoplayTriedUrls.delete(this.autoplayTriedUrls.values().next().value);
    const controller = new AbortController();
    this.suggestionAbort = controller;
    const suggestionTask = this.suggestions
      ? this.suggestions.candidates(current).then(items => items.find(item => !this.autoplayTriedUrls.has(item.url)) || null)
      : resolveSuggestedTrack(current, this.autoplayTriedUrls,
        (query, options) => searchYouTube(query, options.limit, undefined, controller.signal), artworkFrom);
    suggestionTask
      .then(suggestion => {
        if (!suggestion || generation !== this.nextGeneration || (this.current && this.current !== current) || this.queue.length) return;
        this.autoplayTriedUrls.add(suggestion.url);
        this.queue.push(suggestion);
        this.suggestions?.removeUrl(suggestion.url);
        scheduleMusicSave();
        if (!this.current) this.playNext();
        else this.prepareNext(false);
      }).catch(error => {
        if (!controller.signal.aborted && generation === this.nextGeneration) console.error(`[autoplay:${this.guild.id}] ${error.message}`);
      });
  }

  recordStreamEnd(reason, job = this.activePipeline, track = this.current || job?.track, resource = this.resource) {
    if (!job || job.endLogged) return;
    job.endLogged = true;
    console.log(`[stream-end] ${streamEndDiagnostic(this, track, job, reason, resource)}`);
  }

  cancelActive() {
    this.transitions?.cancel();
    const pipeline = this.activePipeline;
    if (pipeline) this.recordStreamEnd(pipeline.error ? "error" : pipeline.naturalAudioEnd ? "natural" : "intentional abort");
    this.activePipeline = null;
    this.resource = null;
    pipeline?.cancel?.();
    if (pipeline?.termination) this.pipelineTermination = pipeline.termination;
  }

  async playNext(endedTrack = null, trackToPlay = null, { recoverable = false } = {}) {
    if (shuttingDown || (this.current && this.playing && !trackToPlay)) return;
    const generation = this.playbackGeneration = (this.playbackGeneration || 0) + 1;
    clearTimeout(this.emptyTimer);
    const next = trackToPlay || this.queue.shift();
    const natural = !trackToPlay && Boolean(endedTrack || (this.lastNaturalEndAt && Date.now() - this.lastNaturalEndAt <= NATURAL_HANDOVER_GRACE_MS));
    if (next) this.lastNaturalEndAt = null;
    const prefetch = this.prefetch;
    const prepared = next && !trackToPlay && prefetch?.track === next ? prefetch?.job : null;
    if (prepared) this.prefetch = null;
    if (next) this.invalidateNext();
    this.cancelActive();
    const termination = this.pipelineTermination;
    if (termination) {
      await termination;
      if (this.pipelineTermination === termination) this.pipelineTermination = null;
      if (generation !== this.playbackGeneration || shuttingDown) return;
    }
    if (!next) {
      this.cancelPrefetch();
      this.current = null;
      this.panelSuggestions = [];
      this.playing = false;
      updatePresence();
      scheduleMusicSave();
      return;
    }
    this.panel?.identifyTrack(next);
    this.current = next;
    this.suggestions?.load(next);
    this.resumeOffsetSeconds = Number.isFinite(next.resumeAtSeconds) ? next.resumeAtSeconds : 0;
    delete next.resumeAtSeconds;
    this.playing = true;
    updatePresence();
    if (!trackToPlay) this.totalTracksPlayed++;
    let job;
    try {
      job = prepared || createAudioPipeline(next, this.audioFilters, this.resumeOffsetSeconds);
      this.activePipeline = job;
      job.track = next;
      job.playbackGeneration = generation;
      job.onDiagnostic = error => console.error(`[stream-failure] ${streamFailureDiagnostic({ ...this, activePipeline: job }, next, error)}`);
      const active = () => this.activePipeline === job && this.playbackGeneration === generation;
      job.shouldIgnoreFailure = error => {
        if (!active()) return false;
        const expected = isExpectedPipeFailure(error.stderr || error.message, {
          intentionallyAborted: job.intentionallyAborted, naturalAudioEnd: job.naturalAudioEnd,
          positionSeconds: playbackPosition(this), durationSeconds: next.duration
        });
        if (expected && !job.ignoredPipe) console.log(`[${new Date().toISOString()}] [playback:${this.guild.id}] Natural end pipe closure track=${JSON.stringify(next.title)}`);
        return expected;
      };
      job.onFailure = error => {
        if (active() && !job.cancelled && !recoverable) this.failPlayback(next, error);
      };
      if (!job.formatReady) await job.ready;
      if (recoverable && job.audioReady) await job.audioReady;
      if (!active() || job.intentionallyAborted) return;
      if (job.error) throw job.error;
      const resource = createAudioResource(job.stream, { inputType: job.inputType, inlineVolume: true });
      this.resource = resource;
      resource.playbackGeneration = generation;
      this.resourcePlaybackRate = job.rate;
      resource.volume.setVolume(this.volume / 100);
      if (this.transitions) {
        this.transitions.start(resource, { restoring: Boolean(this.restorePromise), fadeIn: shouldFadeIn({
          mode: config.transitionMode, natural, position: this.resumeOffsetSeconds,
          restoring: Boolean(this.restorePromise), loop: this.loop, restart: Boolean(trackToPlay)
        }) });
      }
      console.log(`[${new Date().toISOString()}] [stream:${this.guild.id}] Starting ${next.title}${prepared ? " (prefetched)" : ""} input=${job.inputType}`);
      this.player.play(resource);
      if (recoverable) job.onFailure = error => {
        if (active() && !job.intentionallyAborted) {
          if (this.restartTransaction) job.restartError = error;
          else this.failPlayback(next, error);
        }
      };
      if (job.restartError || job.error) throw job.restartError || job.error;
      this.panel?.trackStarted(next, { restoring: Boolean(this.restorePromise) });
      scheduleMusicSave();
    } catch (error) {
      if (recoverable && (!job || this.activePipeline === job) && !job?.intentionallyAborted) {
        this.recordStreamEnd("error");
        console.error(`[stream-failure] ${streamFailureDiagnostic(this, next, error)}`);
        throw error;
      }
      if ((!job || this.activePipeline === job) && !job?.intentionallyAborted) this.failPlayback(next, error);
    }
  }

  canResumeEarly(track, error) {
    const reason = classifyStreamFailure([this.activePipeline?.stderr, this.activePipeline?.filterStderr, error?.message].filter(Boolean).join("\n"));
    return track && this.current === track && !this.restartTransaction && !this.activePipeline?.intentionallyAborted
      && !["unavailable", "sign-in", "format", "rate-limit"].includes(reason.code)
      && Number.isFinite(track.duration) && playbackPosition(this) < track.duration - NATURAL_END_TOLERANCE_SECONDS
      && (this.resource?.playbackDuration || 0) > 0 && (track.earlyResumes || 0) < 2;
  }

  resumeEarlyEnd(track, error) {
    if (this.earlyResumePromise) return this.earlyResumePromise;
    const operation = this.restartTransaction = {};
    const position = playbackPosition(this);
    const paused = this.player.state?.status === AudioPlayerStatus.Paused || this.pauseOnRestore;
    const recovery = this.restartRecovery;
    const run = async () => {
      let failure = error;
      try {
        while ((track.earlyResumes || 0) < 2 && this.restartTransaction === operation) {
          track.earlyResumes = (track.earlyResumes || 0) + 1;
          console.error(`[stream-resume] ${streamFailureDiagnostic(this, track, failure)} position=${position} attempt=${track.earlyResumes}/2`);
          this.current = null;
          this.invalidateNext(); this.cancelActive(); this.player.stop(true);
          this.pauseOnRestore = paused;
          try {
            await this.playNext(null, { ...track, resumeAtSeconds: position }, { recoverable: true });
            if (this.restartTransaction !== operation) return;
            if (recovery) { recovery.track = this.current; this.restartRecovery = recovery; }
            return;
          } catch (nextError) {
            failure = nextError;
            const reason = classifyStreamFailure([this.activePipeline?.stderr, this.activePipeline?.filterStderr, nextError.message].filter(Boolean).join("\n"));
            if (["unavailable", "sign-in", "format", "rate-limit"].includes(reason.code)) break;
          }
        }
        if (this.restartTransaction === operation) {
          this.restartTransaction = null;
          return this.failPlayback(this.current, failure, { allowResume: false });
        }
      } finally {
        if (this.restartTransaction === operation) this.restartTransaction = null;
      }
    };
    const pending = run();
    this.earlyResumePromise = pending.finally(() => { this.earlyResumePromise = null; });
    return this.earlyResumePromise;
  }

  failPlayback(track, error, { allowResume = true } = {}) {
    if (!track || this.current !== track || this.activePipeline?.intentionallyAborted) return;
    this.recordStreamEnd("error");
    console.error(`[stream-failure] ${streamFailureDiagnostic(this, track, error)}`);
    const detail = [this.activePipeline?.stderr, this.activePipeline?.filterStderr, error.stderr, error.message].filter(Boolean).join("\n");
    const reason = classifyStreamFailure(detail);
    if (reason.code === "403" && !track.http403Retries) {
      const position = playbackPosition(this);
      const wasPaused = this.player.state.status === AudioPlayerStatus.Paused || this.pauseOnRestore;
      this.current = null;
      this.invalidateNext();
      this.cancelActive();
      this.player.stop(true);
      this.pauseOnRestore = wasPaused;
      return this.playNext(null, { ...track, http403Retries: 1, resumeAtSeconds: position });
    }
    if (allowResume && this.canResumeEarly(track, error)) return this.resumeEarlyEnd(track, error);
    if (this.restartRecovery && !this.restartTransaction) return this.rollbackRestart(error);
    const channel = this.guild.client.channels.cache.get(this.notificationChannelId)
      || this.guild.client.channels.cache.get(this.guild.systemChannelId);
    // Stop before emitting Idle, so errors cannot enter repeat or autoplay.
    const queued = this.queue;
    this.stop();
    this.queue = queued;
    scheduleMusicSave();
    channel?.send({ content: `Could not play **${formatTrackTitle(track.title)}**: ${reason.message}. Playback stopped; queued tracks were kept.`, allowedMentions: { parse: [] } }).catch(sendError => {
      console.error(`[playback:${this.guild.id}] Could not send playback error notice: ${sendError.message}`);
    });
  }

  isShortStream() {
    const job = this.activePipeline;
    return Boolean(job?.startedAt && this.resource && this.current
      && this.current.duration - this.resumeOffsetSeconds > 3
      && this.resource.playbackDuration < 3000);
  }

  retryShortStream(track, error) {
    this.recordStreamEnd("early end");
    console.error(`[stream-failure] ${streamFailureDiagnostic(this, track, error)}`);
    const detail = [this.activePipeline?.stderr, this.activePipeline?.filterStderr, error.stderr, error.message].filter(Boolean).join("\n");
    const reason = classifyStreamFailure(detail);
    const retry = track.streamRetry || 0;
    this.current = null; // Ignore Idle emitted by intentional player.stop().
    this.invalidateNext();
    this.cancelActive();
    this.player.stop(true);
    if (retry === 0) {
      return this.playNext(null, { ...track, streamRetry: 1, resumeAtSeconds: this.resumeOffsetSeconds });
    }
    const channel = this.guild.client.channels.cache.get(this.notificationChannelId)
      || this.guild.client.channels.cache.get(this.guild.systemChannelId);
    channel?.send({ content: `Could not play **${formatTrackTitle(track.title)}** after one retry: ${reason.message}. Trying the next queued song if available.`, allowedMentions: { parse: [] } }).catch(() => {});
    this.shortStreamFailures = (this.shortStreamFailures || 0) + 1;
    // Two consecutive exhausted songs indicate a host problem: keep the rest.
    if (this.shortStreamFailures >= 2 || !this.queue.length) {
      this.playing = false;
      updatePresence();
      scheduleMusicSave();
      return;
    }
    return this.playNext();
  }

  async onTrackEnd(endedResource) {
    if (endedResource && (endedResource !== this.resource || endedResource.playbackGeneration !== this.playbackGeneration)) return;
    const endedTrack = this.current;
    if (shuttingDown || !endedTrack) return;
    if (this.restartTransaction) return;
    this.transitions?.cancel();
    const job = this.activePipeline;
    if (job?.intentionallyAborted) return;
    if (job?.error) return this.failPlayback(endedTrack, job.error);
    const position = playbackPosition(this);
    if (Number.isFinite(endedTrack.duration) && position < endedTrack.duration - NATURAL_END_TOLERANCE_SECONDS) {
      this.recordStreamEnd("early end");
      const error = new Error(`Audio ended early at ${position.toFixed(1)}s of ${endedTrack.duration}s.`);
      if (this.canResumeEarly(endedTrack, error)) return this.resumeEarlyEnd(endedTrack, error);
      if (this.restartRecovery) return this.rollbackRestart(error);
      if (this.isShortStream()) return this.retryShortStream(endedTrack, error);
      return this.failPlayback(endedTrack, error, { allowResume: false });
    }
    if (job) job.naturalAudioEnd = true;
    this.recordStreamEnd("natural");
    this.shortStreamFailures = 0;
    delete endedTrack.streamRetry;
    delete endedTrack.http403Retries;
    delete endedTrack.earlyResumes;
    // Pipeline EOF already requires successful child exit; do not await anything here.
    console.log(`[${new Date().toISOString()}] [playback:${this.guild.id}] Ended track=${JSON.stringify(endedTrack.title)} position=${playbackPosition(this).toFixed(1)}s duration=${endedTrack.duration}s`);
    this.rememberPlayed(endedTrack);
    this.restartRecovery = null;
    this.lastNaturalEndAt = this.loop === "track" ? null : Date.now();
    this.current = null;
    if (this.loop === "track") this.queue.unshift(endedTrack);
    else if (this.loop === "queue") this.queue.push(endedTrack);
    await this.playNext(endedTrack);
  }

  rememberPlayed(track) {
    const { url, title, author, duration, thumbnail, requestedById, autoSuggested } = track;
    this.history = [...(this.history || []), { url, title, author, duration, thumbnail, requestedById, autoSuggested }].slice(-20);
  }

  async previous() {
    if (this.restartTransaction || this.skipPromise) throw new Error("Please wait; a stream restart is in progress.");
    this.lastNaturalEndAt = null;
    if (!this.current) return false;
    if (playbackPosition(this) > 5 || !this.history?.length) {
      await this.seek(0);
      return true;
    }
    const previous = this.history.pop();
    const current = { ...this.current };
    delete current.resumeAtSeconds;
    delete current.http403Retries;
    delete current.streamRetry;
    const wasPaused = this.player.state.status === AudioPlayerStatus.Paused;
    this.current = null;
    this.invalidateNext();
    this.cancelActive();
    this.player.stop(true);
    this.queue.unshift(current);
    this.pauseOnRestore = wasPaused;
    await this.playNext(null, { ...previous, resumeAtSeconds: 0 });
    return true;
  }

  skip() {
    // Share an in-flight skip across slash, dashboard and panel callers.
    if (this.skipPromise) return this.skipPromise;
    this.skipPromise = this.skipCurrent().finally(() => { this.skipPromise = null; });
    return this.skipPromise;
  }

  async skipCurrent() {
    if (this.restartTransaction) throw new Error("Please wait; a stream restart is in progress.");
    this.lastNaturalEndAt = null;
    const skipped = this.current;
    if (!skipped) return false;
    this.rememberPlayed(skipped);
    this.current = null;
    this.invalidateNext();
    this.cancelActive();
    this.player.stop(true);
    if (this.loop === "queue") this.queue.push(skipped);
    const started = this.playNext();
    const generation = this.nextGeneration;
    await started;
    // Stop/leave/queue edits during startup must not resurrect autoplay.
    if (!this.current && generation === this.nextGeneration) this.prepareNext(true, skipped);
    return true;
  }

  stop() {
    this.playbackGeneration = (this.playbackGeneration || 0) + 1;
    this.restartTransaction = null;
    this.restartRecovery = null;
    this.lastNaturalEndAt = null;
    this.suggestions?.clearActive();
    this.voiceGeneration = (this.voiceGeneration || 0) + 1;
    this.invalidateNext();
    this.cancelActive();
    this.pausedForEmpty = false;
    this.queue = [];
    this.current = null;
    this.resource = null;
    this.playing = false;
    this.resumeOffsetSeconds = 0;
    updatePresence();
    this.player.stop(true);
    scheduleMusicSave();
  }

  async pausePlayback(reason) {
    if (reason !== "empty") this.pausedForEmpty = false;
    if (!this.playing || this.player.state.status !== AudioPlayerStatus.Playing) return false;
    if (!this.player.pause()) return false;
    scheduleMusicSave();
    return true;
  }

  async resumePlayback(reason) {
    if (reason !== "member joined") this.pausedForEmpty = false;
    if (!this.playing || this.player.state.status !== AudioPlayerStatus.Paused) return false;
    if (!this.player.unpause()) return false;
    scheduleMusicSave();
    return true;
  }

  shuffle() {
    this.invalidateNext();
    for (let index = this.queue.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [this.queue[index], this.queue[other]] = [this.queue[other], this.queue[index]];
    }
    scheduleMusicSave();
    this.prepareNext(false);
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
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.connection = null;
    this.savedVoiceChannelId = null;
    scheduleMusicSave();
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});
const music = new Collection();
setInterval(() => {
  if ([...music.values()].some(state => state.current)) scheduleMusicSave();
}, 5000).unref();
function updatePresence() {
  if (!client.isReady()) return;
  const active = [...music.values()].find(state => state.playing && state.current);
  const activity = active
    ? active.current.title.slice(0, 128)
    : "/play";
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

  await context.reply(queuePayload());
  const message = await context.fetchReply();
  const collector = message.createMessageComponentCollector({
    time: 120_000,
    filter: component => component.customId === "queue:previous" || component.customId === "queue:next"
  });

  collector.on("collect", async component => {
    if (component.user.id !== context.user.id) {
      await component.reply({ content: "Run `/queue` yourself to control these pages.", ephemeral: true });
      return;
    }
    page += component.customId === "queue:next" ? 1 : -1;
    const pageCount = queuePageCount(state.queue);
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

const spotify = createSpotifyClient(config);

async function resolveQuery(query) {
  // YouTube Music playlist URLs use the same playlist endpoint as YouTube.
  // Check for a list ID before yt_validate(), which can classify a watch URL
  // containing a list parameter as a single video.
  if (/^(?:https?:\/\/)?(?:www\.|music\.)?youtube\.com\//i.test(query)
    && /[?&]list=([a-zA-Z0-9_-]+)/i.test(query)) {
    const playlistTracks = await resolvePlaylist(query);
    if (!playlistTracks.length) {
      throw new Error(`No playable tracks up to ${MAX_TRACK_DURATION_SECONDS / 60} minutes long were found in that YouTube playlist.`);
    }
    if (playlistTracks.length > config.maxQueueSize) {
      throw new Error(`That YouTube playlist exceeds the ${config.maxQueueSize}-track queue limit.`);
    }
    return playlistTracks;
  }

  if (/open\.spotify\.com\//i.test(query)) {
    const spotifyTracks = await spotify.items(query);
    return matchSpotifyTracks(spotifyTracks, searchYouTube, artworkFrom);
  }

  // Non-spotify queries still return normally for immediate play
  const urlType = play.yt_validate(query);
  if (urlType === "video") {
    const info = await play.video_basic_info(query);
    if (!hasAllowedDuration(info.video_details.durationInSec)) {
      throw new Error(`That track is longer than ${MAX_TRACK_DURATION_SECONDS / 60} minutes or has no verified duration. Tracks must be ${MAX_TRACK_DURATION_SECONDS / 60} minutes or shorter.`);
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
  if (!match) throw new Error(`No YouTube results ${MAX_TRACK_DURATION_SECONDS / 60} minutes or shorter were found.`);
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
  try { await registerCommands(); }
  catch (error) { console.error(`[startup] Command registration failed: ${error.stack || error.message}`); }
  await loadMusicState();
  await favourites.load();
  for (const [guildId, snapshot] of Object.entries(savedMusicStates)) {
    let state;
    try {
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("Invalid guild snapshot.");
      const guild = await ready.guilds.fetch(guildId);
      if (!guild) continue;
      state = getMusic(guild);
      state.restorePanel?.(snapshot);
      if (typeof snapshot.voiceChannelId === "string") {
        const channel = await guild.channels.fetch(snapshot.voiceChannelId);
        if (!channel?.isVoiceBased()) throw new Error("Saved voice channel is unavailable.");
        await state.restore(snapshot, channel);
      }
    } catch (error) { console.error(`[persistence:${guildId}] Could not restore music state: ${error.message}`); }
    finally { await state?.panel?.reattach(); }
  }
  try {
    if (config.autoJoin && config.voiceChannelId && config.voiceGuildId) {
      const guild = await ready.guilds.fetch(config.voiceGuildId);
      const channel = await guild?.channels.fetch(config.voiceChannelId);
      if (channel?.isVoiceBased() && music.get(guild.id)?.connection?.state.status !== VoiceConnectionStatus.Ready) {
        await getMusic(guild).connect(channel);
      }
    }
  } catch (error) { console.error(`[24/7] ${error.message}`); }
  startupComplete = !shuttingDown;
});

const handleCommand = async interaction => {
  if (!interaction.guild) return;
  if (!startupComplete || shuttingDown) return reply(interaction, { content: "The bot is still initializing or shutting down. Try again shortly.", ephemeral: true });
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
  state.panel?.wake();
  const accessError = musicAccessError(interaction, state);
  if (accessError) return reply(interaction, { content: accessError, ephemeral: true });
  const restartCommand = ["bassboost", "eightd", "nightcore", "echo", "forward", "skip"].includes(interaction.commandName);
  if (restartCommand && (state.interactionRestarting || state.restartTransaction || state.skipPromise)) {
    return reply(interaction, { content: "Please wait; a stream restart is in progress.", ephemeral: true });
  }
  if (restartCommand) state.interactionRestarting = true;
  try {
    if (interaction.commandName === "bassboost") {
      await interaction.deferReply();
      const enabled = !state.audioFilters.bassboost;
      await state.setAudioFilter("bassboost", enabled, content => interaction.followUp({ content, ephemeral: true }));
      return interaction.editReply(`Bass boost is now ${enabled ? "enabled" : "disabled"}.`);
    }
    if (interaction.commandName === "eightd") {
      await interaction.deferReply();
      const enabled = !state.audioFilters.eightd;
      await state.setAudioFilter("eightd", enabled, content => interaction.followUp({ content, ephemeral: true }));
      return interaction.editReply(`8D audio is now ${enabled ? "enabled" : "disabled"}.`);
    }
    if (interaction.commandName === "nightcore") {
      await interaction.deferReply();
      const enabled = !state.audioFilters.nightcore;
      await state.setAudioFilter("nightcore", enabled, content => interaction.followUp({ content, ephemeral: true }));
      return interaction.editReply(`Nightcore is now ${enabled ? "enabled" : "disabled"}.`);
    }
    if (interaction.commandName === "echo") {
      await interaction.deferReply();
      const enabled = !state.audioFilters.echo;
      await state.setAudioFilter("echo", enabled, content => interaction.followUp({ content, ephemeral: true }));
      return interaction.editReply(`Echo is now ${enabled ? "enabled" : "disabled"}.`);
    }
    if (interaction.commandName === "play") {
      let memberChannel = await resolveMemberVoiceChannel(interaction);
      if (!memberChannel) return reply(interaction, { content: "Join a voice channel first.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const query = interaction.options.getString("query", true);
      const tracks = await resolveQuery(query);
      if (!tracks.length) return interaction.editReply("No playable tracks were found.");
      memberChannel = await resolveMemberVoiceChannel(interaction);
      const accessError = musicAccessError(interaction, state);
      if (accessError || !memberChannel) return interaction.editReply(accessError || "Join a voice channel first.");
      await state.add(tracks, memberChannel, interaction.user.id, interaction.channel);
      await state.panel.ensure(interaction.channel.id);
      // Finish the private deferral before creating a separate public follow-up.
      // Discord cannot change the visibility of an existing interaction response.
      await interaction.editReply({ content: "Tracks queued.", allowedMentions: { parse: [] } });
      await interaction.followUp(buildPlayConfirmation(tracks));
      await interaction.deleteReply().catch(() => {});
      return;
    }

    if (interaction.commandName === "set-notification-channel") {
      const channel = interaction.options.getChannel("channel", true);

      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return reply(interaction, "Choose a text or announcement channel.");
      if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
        return reply(interaction, `I don't have permission to send messages in ${channel}. Please check my permissions.`);
      }
      state.notificationChannelId = channel.id;
      scheduleMusicSave();
      return reply(interaction, `Notification channel set to ${channel}.`);
    }
    if (interaction.commandName === "join") {
      await interaction.deferReply({ ephemeral: true });
      const channel = await resolveMemberVoiceChannel(interaction);
      const denied = musicAccessError(interaction, state);
      if (denied || !channel) return interaction.editReply(denied || "Join a voice channel first.");
      await state.connect(channel);
      return interaction.editReply("Connected to your voice channel.");
    }
    if (interaction.commandName === "247") {
      if (!config.voiceChannelId || !config.voiceGuildId) return reply(interaction, "Set VOICE_CHANNEL_ID and VOICE_GUILD_ID in .env first.");
      await interaction.deferReply({ ephemeral: true });
      const channel = await interaction.guild.channels.fetch(config.voiceChannelId);
      const denied = musicAccessError(interaction, state);
      if (denied) return interaction.editReply(denied);
      await state.connect(channel);
      return interaction.editReply("Connected to the configured 24/7 voice channel.");
    }
    if (interaction.commandName === "pause") {
      if (!await state.pausePlayback("manual")) return reply(interaction, "Nothing is playing.");
      return interaction.reply({
        embeds: [buildPlaybackEmbed({ user: interaction.user, title: "Playback paused", track: state.current })]
      });
    }
    if (interaction.commandName === "resume") {
      if (!await state.resumePlayback("manual")) return reply(interaction, "Playback is not paused.");
      return interaction.reply({
        embeds: [buildPlaybackEmbed({ user: interaction.user, title: "Playback resumed", track: state.current })]
      });
    }
    if (interaction.commandName === "forward") {
      if (!state.current) return reply(interaction, "Nothing is playing.");
      const time = interaction.options.getString("time") ?? "10";
      if (!/^(?:\d+|\d+:[0-5]\d)$/.test(time)) {
        return reply(interaction, "Enter a positive number of seconds or m:ss, for example 10 or 1:30.");
      }
      const parts = time.split(":").map(Number);
      const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
      if (!Number.isSafeInteger(seconds) || seconds <= 0) {
        return reply(interaction, "Enter a positive number of seconds or m:ss, for example 10 or 1:30.");
      }
      const position = playbackPosition(state);
      await interaction.deferReply();
      await state.seek(position + seconds);
      return interaction.editReply(`Forwarded to ${formatDuration(state.resumeOffsetSeconds)}.`);
    }
    if (interaction.commandName === "skip") {
      await interaction.deferReply();
      const skipped = await state.skip();
      return interaction.editReply(skipped ? "Skipped the current track." : "Nothing is playing.");
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
      await interaction.deferReply({ ephemeral: true });
      const message = await state.panel.move(interaction.channel.id);
      return interaction.editReply(message ? "Player panel moved here." : "Could not move the player panel. Check the bot's channel permissions.");
    }
    if (interaction.commandName === "stats") {
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
      state.queueChanged();
      scheduleMusicSave();
      return reply(interaction, `Repeat mode set to ${state.loop}.`);
    }
    if (interaction.commandName === "remove") {
      const position = interaction.options.getInteger("position", true);
      if (position < 1 || position > state.queue.length) {
        return reply(interaction, `Invalid position. The queue has ${state.queue.length} songs.`);
      }
      const removed = state.queue.splice(position - 1, 1)[0];
      state.queueChanged();
      scheduleMusicSave();
      return reply(interaction, `Removed **${formatTrackTitle(removed.title)}** from the queue.`);
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
      return lyrics.open(interaction, { track: state.current, song: interaction.options.getString("song") });
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
            label: short(r.title, 100),
            description: short(`${r.channel?.name || "Unknown"} \u00b7 ${formatDuration(r.durationInSec)}`, 100),
            value: String(i)
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
          try {
            if (i.user.id !== interaction.user.id) return await i.reply({ content: "This menu is not for you!", ephemeral: true });
            const result = results[i.values[0]];
            if (!result) throw new Error("That search result is no longer available.");
            const track = { url: result.url, title: result.title, author: result.channel?.name || "Unknown", duration: result.durationInSec, thumbnail: result.thumbnails?.[0]?.url };
            const memberChannel = await resolveMemberVoiceChannel(i);
            if (!memberChannel) return await i.reply({ content: "Join a voice channel first.", ephemeral: true });

            const accessError = musicAccessError(i, state, "play");
            if (accessError) return await i.reply({ content: accessError, ephemeral: true });
            await i.deferUpdate();
            await state.add([track], memberChannel, i.user.id, i.channel);
            await i.editReply({ content: `Added **${formatTrackTitle(track.title)}** to the queue!`, components: [], allowedMentions: { parse: [] } });
          } catch (error) {
            console.error(`[command:search] ${error.stack || error.message}`);
            const payload = { content: "Could not add that search result. Check the host logs for details.", ephemeral: true };
            if (i.deferred || i.replied) await i.followUp(payload).catch(() => {});
            else await i.reply(payload).catch(() => {});
          }
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
    const errorMessage = ["bassboost", "eightd", "nightcore", "echo", "forward"].includes(interaction.commandName)
      ? "The audio change could not be applied. Previous settings were restored if playback could be recovered."
      : "The command could not be completed. Check permissions and input, then try again. Details are in the host logs.";
    if (interaction.deferred) await interaction.editReply(errorMessage).catch(() => {});
    else await reply(interaction, errorMessage);
  } finally {
    if (restartCommand) state.interactionRestarting = false;
  }
};

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const state = getMusic(newState.guild);
  if (!state.connection) return;
  const voiceChannel = state.connection.joinConfig.channelId;
  if (oldState.channelId !== voiceChannel && newState.channelId !== voiceChannel) return;

  const channel = newState.guild.channels.cache.get(voiceChannel);
  const humans = channel?.members.filter(member => !member.user.bot).size;
  if (humans === undefined) return;
  const textChannel = state.notificationChannelId
    ? newState.guild.channels.cache.get(state.notificationChannelId)
    : newState.guild.systemChannel;

  if (humans === 0) {
    if (state.player.state.status === AudioPlayerStatus.Playing && await state.pausePlayback("empty")) {
      state.pausedForEmpty = true;
      textChannel?.send("Music paused because no one is in the voice channel.").catch(() => {});
    }
    state.scheduleEmptyDisconnect();
  } else {
    clearTimeout(state.emptyTimer);
    state.emptyTimer = null;
    const shouldResume = state.pausedForEmpty;
    state.pausedForEmpty = false;
    if (shouldResume && await state.resumePlayback("member joined")) {
      textChannel?.send("Music resumed because someone joined the voice channel!").catch(() => {});
    }
  }
});

const handlePanelInteraction = createPanelInteractionHandler({ getMusic, favourites, lyrics, isReady: () => startupComplete && !shuttingDown });

client.on(Events.InteractionCreate, async interaction => {
  if (await lyrics.handleModal(interaction)) return;
  if (await handlePanelInteraction(interaction)) return;
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction);
});

client.on(Events.GuildDelete, guild => {
  const state = music.get(guild.id);
  state?.suggestions?.dispose();
  state?.panel?.dispose();
  state?.disconnect();
  music.delete(guild.id);
  delete savedMusicStates[guild.id];
  musicSaveChain = musicSaveChain.then(() => storage.deleteGuild(guild.id))
    .catch(error => console.error(`[persistence:${guild.id}] Could not delete departed guild: ${error.message}`));
});

client.on(Events.MessageCreate, createMentionHandler(() => client.user?.id));

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
    ? Math.floor(playbackPosition(state))
    : 0;
  const channelId = state?.connection?.joinConfig.channelId || null;
  return {
    id: guild.id,
    name: guild.name,
    connected: state?.connection?.state.status === VoiceConnectionStatus.Ready,
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
      playbackRate: state.resourcePlaybackRate || 1,
      requestedBy: dashboardRequesterLabel(current),
      status: state.player.state.status === AudioPlayerStatus.AutoPaused ? "paused" : state.player.state.status
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
  if (!startupComplete || shuttingDown) throw dashboardError("The bot is still initializing or shutting down.", 503);
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
    await state.skip();
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
    state.queueChanged();
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
    state.queueChanged();
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

const healthServer = createHealthServer({
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
    const ready = client.isReady() && startupComplete && !shuttingDown;
    const active = [...music.values()].find(state => state.playing && state.current);
    const track = active?.current;
    return {
      ready,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      pingMs: client.ws.ping,
      serverCount: ready ? client.guilds.cache.size : 0,
      track: track ? {
        title: track.title,
        artist: track.author,
        thumbnail: track.thumbnail || null,
        positionSeconds: Math.floor(playbackPosition(active)),
        durationSeconds: track.duration || null,
        playbackRate: active.resourcePlaybackRate || 1,
        status: active.player.state.status === AudioPlayerStatus.AutoPaused ? "paused" : active.player.state.status
      } : null
    };
  }
}).listen(config.port, () => console.log(`Health website listening on :${config.port}/health`));

async function shutdown(exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  startupComplete = false;
  clearTimeout(musicSaveTimer);
  const cleanup = () => {
    for (const state of music.values()) {
      state.suggestions?.dispose();
      state.panel?.dispose();
      state.voiceGeneration = (state.voiceGeneration || 0) + 1;
      state.invalidateNext();
      state.cancelActive();
      clearTimeout(state.emptyTimer);
      const connection = state.connection;
      state.connection = null;
      if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    }
    healthServer.close();
    client.destroy();
  };
  // A failed storage/network call must not leave children running indefinitely.
  const deadline = setTimeout(() => { cleanup(); process.exit(1); }, 10000);
  deadline.unref?.();
  shutdownPromise = (async () => {
    try {
      await musicSaveChain;
      await writeMusicState().catch(error => console.error(`[persistence] Shutdown save failed: ${error.message}`));
      await favourites.flush();
    } catch (error) { console.error(`[persistence] Shutdown save failed: ${error.message}`); }
    finally { clearTimeout(deadline); cleanup(); process.exit(exitCode); }
  })();
  return shutdownPromise;
}

process.on("SIGINT", () => { void shutdown(); });
process.on("SIGTERM", () => { void shutdown(); });
process.on("unhandledRejection", error => {
  console.error("[process] Unhandled rejection:", error?.stack || error);
  void shutdown(1);
});
process.on("uncaughtException", error => {
  console.error("[process] Uncaught exception:", error?.stack || error);
  void shutdown(1);
});

client.on(Events.Error, error => {
  console.error(`[discord] Client error: ${error.code || error.name}`);
});
client.on(Events.ShardError, (error, shardId) => {
  console.error(`[discord] Shard ${shardId} error: ${error.code || error.name}`);
});
client.on(Events.ShardDisconnect, (event, shardId) => {
  console.error(`[discord] Shard ${shardId} disconnected with code ${event.code}.`);
});
client.rest.on(RESTEvents.Response, (request, response) => {
  if (request.route !== "/gateway/bot") return;
  console.log(`[discord] Gateway API returned HTTP ${response.status}.`);
});
client.rest.on(RESTEvents.RateLimited, data => {
  if (data.route !== "/gateway/bot") return;
  const seconds = Math.ceil(Math.max(data.retryAfter, data.timeToReset) / 1000);
  console.error(`[discord] Gateway API rate limited. Waiting ${seconds} seconds before retrying.`);
});
client.on(Events.Debug, message => {
  // Log fixed milestones only; raw debug messages can contain token fragments.
  if (message.includes("Fetched Gateway Information")) {
    console.log("[discord] Gateway details received.");
  } else if (message.includes("Connecting to wss://")) {
    console.log("[discord] Opening gateway WebSocket.");
  } else if (message.includes("Waiting for identify throttle")) {
    console.log("[discord] Waiting for gateway identify allowance.");
  } else if (message.includes("] Identifying")) {
    console.log("[discord] Identifying with the gateway.");
  }
});

async function startBot() {
  let phase = "YouTube cookie preparation";
  const startupTimer = setTimeout(() => {
    console.error(`[startup] Still waiting for ${phase} after 30 seconds. Discord ready: ${client.isReady()}.`);
  }, 30000);
  startupTimer.unref();
  client.once(Events.ClientReady, () => clearTimeout(startupTimer));
  try {
    await logYtdlpVersion();
    console.log("[startup] Preparing YouTube cookies (if configured).");
    await prepareYouTubeCookies();
    phase = "Discord login";
    console.log("[startup] Cookie preparation complete. Connecting to Discord.");
    await client.login(config.token);
  } catch (error) {
    clearTimeout(startupTimer);
    console.error(`[startup] Failed during ${phase}: ${error.code || error.name}`);
    process.exit(1);
  }
}

startBot();
