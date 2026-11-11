# Discord music bot — code breakdown

Based on the actual working tree inspected on 11 November 2026, including existing uncommitted changes. This is a source review, not a live Discord/YouTube playback test. Secrets are omitted. Complete main source files are pasted at the end.

## 1. Overview

This bot plays music in Discord voice channels, with a shared queue per server. People request YouTube searches/videos/playlists or Spotify tracks/albums/playlists. Spotify provides metadata; the bot searches YouTube for matching audio rather than streaming Spotify audio. It offers queue controls, repeat, volume, four audio effects, live track cards, automatic song suggestions, startup voice joining, and playback recovery after restarts.

It also serves a public status website and a token-protected browser dashboard. There is no Lavalink service, external database, Express server, React app, or discord.py.

The language is JavaScript using CommonJS (`require` and `module.exports`). No explicit ECMAScript edition is pinned. Project version: **1.0.0**. Required Node version: **>=22.12.0**. Inspection environment: **Node v24.19.0**, **npm 11.17.0**. The deployed runtime version cannot be established from these files.

| Library | package.json range | package-lock version | Actual use |
|---|---|---|---|
| discord.js | ^14.22.1 | 14.27.0 | Client, slash commands, messages, embeds, REST registration, collectors |
| @discordjs/voice | ^0.19.2 | 0.19.2 | Voice connections, audio players/resources, stream types |
| play-dl | ^1.9.7 | 1.9.7 | YouTube URL validation and direct-video metadata |
| youtube-dl-exec | ^3.1.15 | 3.1.15 | Runs yt-dlp for searches, playlist metadata, streaming audio |
| ffmpeg-static | ^5.3.0 | 5.3.0 | Bundled FFmpeg executable for filtering/conversion and yt-dlp support |
| opusscript | ^0.0.8 | 0.0.8 | Opus codec implementation available to the voice pipeline |
| dotenv | ^16.6.1 | 16.6.1 | Loads .env |

Node built-ins supply HTTP, filesystem access, crypto, child processes, fetch, and tests. Spotify uses fetch directly. The exact downloaded yt-dlp/FFmpeg executable versions are not pinned by the application source.

## 2. File structure

| File/folder | Responsibility |
|---|---|
| package.json | Main entry point, scripts, Node requirement, direct dependency ranges |
| package-lock.json | Exact npm dependency resolution |
| src/index.js | Config, persistence, GuildMusic player class, Spotify and query resolution, Discord events, actual command handler, dashboard backend, startup/shutdown |
| src/commands.js | Slash definitions, prefix aliases/parser, help categories, embeds, queue buttons, duration formatting and requester labels; does not dispatch commands |
| src/music-utils.js | Duration policy, yt-dlp cookies/time/search/playlists, autoplay filtering, Genius search links |
| src/health-server.js | HTTP routes, bearer authentication, JSON validation, health/dashboard responses |
| src/health-page.js | Exported HTML/CSS/browser JS string for public status page; polls every 15 seconds, progress every second |
| src/dashboard-page.js | Exported dashboard HTML/CSS/browser JS; token storage, five-second refresh, music controls |
| test/dashboard-page.test.js | Embedded browser JS syntax and selected dashboard markup |
| test/health-server.test.js | Pages/favicon/health, dashboard authentication, JSON content type |
| test/requester-label.test.js | Requester labels and yt-dlp cookie options |
| .env.example | Setup template with concrete example voice/server IDs and tuning values |
| .env | Private local configuration; not reproduced |
| .gitignore | Excludes node_modules, .env, cookies.txt, logs and data |
| README.md | Setup, commands, dashboard, persistence and Railway instructions; partly stale |
| render.yaml | Render Node web-service blueprint |
| railpack.json | Adds Python 3 to Railpack deployment runtime |
| index_start.txt, index_end.txt | Source-like snapshots, both starting with imports; not used by npm scripts/runtime |
| node_modules/ | Installed dependency tree |
| data/music-state.json | Default generated recovery state path; configurable, ignored by git |

No project AGENTS.md, Dockerfile, or CI workflow was found in the workspace inventory.

Key locations in src/index.js: config/persistence line 48; GuildMusic line 137; resolveQuery line 780; registration line 884; ready event line 891; command handler line 931; prefix adapter line 1222; dashboard backend line 1337; shutdown line 1497.

## 3. Commands

There are **31 registered slash commands**. The prefix is a literal dot (.): `.play song`. Canonical names generally work with that prefix, subject to the defects below. Names are case-insensitive; whitespace after the dot is not allowed. No custom prefix setting exists.

All commands are guild-only in the handler; DMs return without replying. **Only 247 has a special member-permission rule:** slash registration defaults to Manage Server (ManageGuild); prefix explicitly checks it. The slash handler relies on Discord's command permissions rather than rechecking ManageGuild. All commands remain subject to Discord's application-command configuration.

Other commands have no DJ role, requester-only check, same-voice-channel check, or administrative restriction. Play/join require the caller to be in voice; choosing a search result also requires voice. A new play/join can move the bot to a different channel. Other members can pause/clear/change music without joining its voice channel.

| Slash | Options | Extra prefix alias | Actual behavior |
|---|---|---|---|
| /help | category optional: all, guide, playback, queue, voice, settings | .h | Public categorized guide; default all |
| /ping | none | none | Gateway latency, rounded/clamped >=0 |
| /uptime | none | none | Current process uptime |
| /stats | none | .stt | Server queue length, track-start count, process uptime |
| /play | query required string | .p | Resolve YouTube/Spotify, join caller, enqueue/start, post live card |
| /pause | none | .pa | Pause player; reports success without checking whether anything was playing |
| /resume | none | .r | Unpause; reports success without checking result |
| /skip | none | .sk | Stop player; Idle triggers ordinary repeat/advance/autoplay |
| /stop | none | .st | Clear current/queue, kill subprocesses, stop player; remain connected |
| /leave | none | .lv | Stop/clear and destroy connection |
| /join | none | .j | Join caller's voice channel, self-deafened |
| /247 | none | none | Join configured channel; Manage Server; no separate persistent 24/7 mode flag |
| /queue | none | .q | Current and waiting tracks, ten/page, requester labels; buttons last two minutes and only invoker may page |
| /shuffle | none | .sh | Fisher-Yates shuffle of waiting tracks |
| /loop | mode required: off, track, queue | .l | Set repeat mode |
| /nowplaying | none | .np | Live position/artwork/requester card, about one edit/second |
| /volume | percent required integer 0–200 | .vol | Change current gain and future volume |
| /volup | none | none | +10 percentage points, capped at 200 |
| /voldown | none | none | -10 percentage points, floored at 0 |
| /bassboost | none | .bb | Toggle FFmpeg bass=g=10 |
| /eightd | none | .8d | Toggle apulsator=hz=0.1 |
| /nightcore | none | .nc | Toggle asetrate=44100*1.2,atempo=1.2 |
| /echo | none | .ec | Toggle aecho=0.8:0.88:60:0.4 |
| /remove | position required integer >=1 | .rm | Remove waiting track, one-based; prefix argument parsing broken |
| /move | from/to required integers >=1 | .mv | Reorder waiting tracks; prefix argument parsing broken |
| /clear | none | .cl | Clear waiting tracks, preserve current |
| /lyrics | none | .ly | Current song plus Genius search link; no actual lyrics retrieval or verified exact lyrics page |
| /search | query required string | .sr | Intended five-result menu, sixty seconds, invoker-only; defects below |
| /playlist | url required string | .pl | REGISTERED BUT NO HANDLER; slash times out, prefix does nothing. /play accepts YouTube playlist URLs |
| /forward | time optional string, advertised seconds or m:ss | none | REGISTERED BUT NO HANDLER; no implemented command/default duration |
| /set-notification-channel | channel required | .sn | In-memory notification channel; prefix accepts ID/mention; checks bot SendMessages, no member management permission |

Effects restart the current stream at its approximate position and remain enabled for later tracks until toggled. They can also be toggled while idle.

`pause-track` and `resume-track` have handler branches/help entries but no slash definitions; the prefix regex also rejects hyphens. They are unreachable normally. The full prefix `.set-notification-channel` is likewise unparseable; `.sn` works.

Prefix parsing only implements play query, help category, loop mode, notification channel, and volume percent. Remove/move receive null integers; search receives a null query. Uppercase prefix loop/help values validate case-insensitively but are passed unchanged, causing broken repeat or a help error.

Bot invite/setup permissions in README: View Channel, Connect, Speak, Send Messages, Embed Links, Use Application Commands; OAuth scopes bot and applications.commands. Enable privileged Message Content Intent for prefixes. No general explicit Connect/Speak preflight exists in code.

Queue numbering is misleading: when current exists, the first waiting entry is displayed #2, but `/remove position:1` removes that first waiting entry. Dashboard positions are separately zero-based internally.

## 4. How music playback works

1. `interactionCreate` forwards chat-input commands to handleCommand. Prefix messages build an interaction-like adapter and use the same handler.
2. Play obtains the member's voice channel, rejects if absent, defers the reply, starts a resolution task, and edits to “Searching for tracks...”. That task later edits/posts the result.
3. resolveQuery chooses the source:
   - YouTube/music.youtube.com URLs containing list= are handled as playlists before video validation. yt-dlp returns flat playlist metadata; valid-duration tracks are retained. Even a watch URL with list= becomes a playlist request.
   - Spotify authenticates with client credentials. It fetches one track or paginates album/playlist tracks using limit=100, rejects releases exceeding configured count, and filters invalid/long metadata. Each title + first artist + “audio” becomes a YouTube search. Actual callers omit the optional state parameter, so they use the “legacy” branch with up to **45 concurrent searches**, await the batch, preserve input order, and retain the first duration-valid YouTube result. Spotify titles/artists remain attached to the resulting YouTube URL. There is no similarity score or duration comparison to the Spotify original.
   - Direct videos use play-dl yt_validate/video_basic_info for metadata.
   - Other input uses yt-dlp ytsearch10:<query>; first result with URL and allowed duration wins.
4. The ordinary duration predicate is finite, >0, **<=30 minutes**. Autoplay alone uses <=6 minutes. Most six-minute messages/docs are stale.
5. GuildMusic.add first connects/moves voice, then validates duration/capacity. It appends tracks with requestedById, resets autoplay exclusions, replaces notification channel with the invoking text channel, schedules persistence, and starts playNext if idle. Queue cap excludes current.
6. connect calls joinVoiceChannel with channel/guild IDs and guild voice adapter, selfDeaf=true, selfMute=false. It subscribes the server's player and waits up to 15 seconds for Ready. Existing non-destroyed same-channel connections are reused.
7. playNext kills old download/filter processes, clears resource, and shifts the waiting array. It sets current/playing/presence and increments the counter unless explicitly restarting a track.
8. youtube-dl-exec starts yt-dlp with bestaudio, output '-', noPlaylist, cookies if configured, and bundled FFmpeg location. Audio arrives on child stdout. Resume/seek adds downloadSections from formatted offset to infinity. Songs are streamed, not cached as files.
9. Without effects, stdout is labeled StreamType.WebmOpus. With effects, a spawned FFmpeg process reads stdout, applies selected filters, and outputs raw 48 kHz stereo signed 16-bit PCM; resource type is Raw.
10. createAudioResource enables inlineVolume. Gain is percent/100. player.play starts the resource; @discordjs/voice delivers audio to the subscribed connection.
11. The reply becomes a live card. One card is tracked per text channel; another replaces/deletes the old tracked card. It schedules the next update one second after each edit completes and stops on missing current or edit failure.

Each guild has a waiting array distinct from current. Tracks hold URL/title/author/duration/artwork/requester; suggestions also carry autoSuggested.

On AudioPlayer Idle, onTrackEnd captures current, clears it, puts it at the FRONT for track-repeat or BACK for queue-repeat, then calls playNext(endedTrack). **Skip therefore honors repeat**, including replaying the skipped song in track mode. Player errors also follow this repeat path.

When the queue is empty after a track, autoplay searches “<first artist> similar songs” and “<first artist> popular songs”, fifteen results each. It rejects live/unknown-duration/>6-minute results, non-song title patterns (mixes, concerts, compilations, etc.), ended URL/near-identical normalized titles, and tried URLs. It chooses the first eligible result in insertion order. It is not random selection or a related-video API. No exposed autoplay toggle exists. Failure/exhaustion leaves playback idle but connected. Stop avoids autoplay by clearing current before stopping.

Shuffle affects only waiting tracks. Clear preserves current. Inline volume updates immediately and applies to future resources. Dashboard seek preserves pause state, clamps to duration minus two seconds, and restarts the URL. Forward never invokes seek. Position is resumeOffsetSeconds + resource.playbackDuration/1000; this does not correct source time for nightcore rate changes.

## 5. Events and state

| Event/timer | Response |
|---|---|
| ClientReady, once | Set presence, REST v10 command registration, load/restore saved guilds, optional configured join |
| InteractionCreate | Slash chat-input dispatch; components handled by collectors |
| MessageCreate | Ignore bots/DMs, parse/validate prefix, adapt and dispatch |
| VoiceStateUpdate | TWO duplicate handlers attempt empty pause/member-join resume; defective filtering |
| Player Idle | Repeat/advance/autoplay |
| Player stateChange | Log, apply paused restoration when Playing, save |
| Player error | Log, notification/system-channel failure notice, onTrackEnd |
| Connection error/stateChange | Log; limited disconnect recovery |
| yt-dlp stderr/close/rejection | Last 2,000 stderr characters, failure logs/source destruction |
| FFmpeg error/close/stdin errors | Log/destroy output; ignore expected cancellation/EPIPE |
| Queue collector | Invoker-only paging for two minutes; remove controls |
| Search collector | Invoker-only select for one minute; enqueue; remove controls |
| Five-second checkpoint | Schedule save if any current track exists |
| SIGINT/SIGTERM | Save, kill subprocesses, destroy connections/client, exit |

`music` is a Discord Collection keyed by guild ID; getMusic lazily creates GuildMusic. Each holds queue/current/resource, loop/volume/offset, restore pause flag, saved voice ID, tried-URL Set, player/connection, subprocesses, empty timer, notification channel, playing flag, count and filter flags. Even voice events can create otherwise-unused states. No guildDelete cleanup exists.

`liveNowPlaying` is a Map keyed by text-channel ID. Presence is Do Not Disturb, Listening to the first active track title or dot-play when idle.

Recovery JSON is `{version:1,guilds:{...}}`; each snapshot contains voiceChannelId/current/positionSeconds/paused/queue/loop/volume. Requester IDs persist inside track objects. Filters, notification channel, count, and autoplay exclusions do not persist.

Saves debounce one second and serialize through a promise chain: mkdir, write temporary file, rename. Missing state means empty; invalid/unreadable state disables saving to preserve the file. Startup restores valid tracks, capped queue, voice channel, position and pause status. It rejoins saved channels even if AUTO_JOIN_VOICE=false; that flag controls only the additional configured startup join. Without a valid saved voice channel, that guild's saved queue is not loaded into a player.

## 6. Configuration and setup

These are code defaults, not private .env values.

| Variable | Default/requirement | Use |
|---|---|---|
| DISCORD_TOKEN | required, <REDACTED> | Login/REST |
| GUILD_ID | blank | Guild-only registration; otherwise global; voice-guild fallback |
| SPOTIFY_CLIENT_ID | optional, <REDACTED> if configured | Spotify auth |
| SPOTIFY_CLIENT_SECRET | optional, <REDACTED> if configured | Spotify auth |
| YOUTUBE_COOKIES_FILE | unset | Private cookie-file path for yt-dlp |
| VOICE_CHANNEL_ID | blank | Configured startup/247 channel |
| VOICE_GUILD_ID | GUILD_ID or blank | Startup server |
| AUTO_JOIN_VOICE | true unless exact 'false' | Additional configured startup join |
| PORT | 3000, range 1–65535 | Always-started HTTP server |
| MUSIC_DASHBOARD_TOKEN | blank, <REDACTED> if configured | Shared bearer secret |
| DEFAULT_VOLUME | 80, range 0–200 | Initial gain |
| LEAVE_ON_EMPTY | false unless exact 'true' | Enables unused disconnect scheduler |
| EMPTY_CHANNEL_TIMEOUT_SECONDS | 300, range 5–86400 | Unused scheduler timeout |
| MAX_QUEUE_SIZE | 2000, range 1–2000 | Waiting queue/release limit |
| MUSIC_STATE_FILE | data/music-state.json | Recovery path relative to working directory |
| YOUTUBE_DL_SKIP_PYTHON_CHECK | installer option | Build workaround, not read by bot |

Numeric env parsing accepts finite in-range numbers, including fractions; invalid values revert to defaults. .env.example sets volume=100 and max queue=1000, different from defaults, and includes hardcoded example guild/channel IDs that must be replaced. MUSIC_STATE_FILE is documented in README but absent from .env.example.

Local setup per repository:

```powershell
Copy-Item .env.example .env
# Edit .env privately with DISCORD_TOKEN=<REDACTED>, your IDs and optional secrets.
npm ci
npm run check
npm test
npm start
```

README also uses npm install. FFmpeg comes from ffmpeg-static. youtube-dl-exec installs/runs yt-dlp; Linux hosting instructions supply Python 3. README's Windows installer workaround:

```powershell
$env:YOUTUBE_DL_SKIP_PYTHON_CHECK='1'
npm install
Remove-Item Env:YOUTUBE_DL_SKIP_PYTHON_CHECK
```

No YouTube API key or Lavalink credentials are configured. Direct YouTube metadata uses play-dl and does not receive YOUTUBE_COOKIES_FILE; yt-dlp searches/playlists/audio do. Outbound Discord voice/YouTube access is required; Spotify access when used.

Website routes:

- `/` and `/health`: public HTML; `/favicon.svg`: built-in favicon.
- `/healthz`: JSON, 200 when Discord client ready, else 503.
- `/api/health`: same JSON, or HTML for Accept containing text/html. Exposes server count and first active track including server name.
- `/dashboard`: public HTML shell, per-tab sessionStorage token, five-second refresh.
- `GET /api/dashboard`: bearer-protected snapshots of all cached guilds, voice channels and queues.
- `POST /api/dashboard/actions`: pause/resume/skip/stop/seek/volume/loop/add/remove/move/clear/shuffle/connect/disconnect. Dashboard indices are zero-based. No effects action exists.

Authentication uses length comparison and timingSafeEqual. Unconfigured token gives 503; invalid token 401; wrong methods 405. Actions require application/json object, <=16 KiB. Validation errors return 4xx; unexpected errors are logged with generic 500 response. One dashboard token controls all servers; no Discord OAuth/role check, built-in TLS or rate limiter. README instructs HTTPS for external access.

Hosting: render.yaml defines a Render starter Node web service, build `YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm ci`, start `npm start`. README describes Railway GitHub deployment, same commands, a volume at /data, MUSIC_STATE_FILE=/data/music-state.json, and Railway-supplied PORT. railpack.json installs python3. Render blueprint does not itself configure persistent disk/Python. Actual live deployment, domain, volume or host cannot be verified from these files. Always-on voice requires an always-on host; recovery requires durable storage.

## 7. Error handling

- Missing token throws before startup. Query/auth/voice errors generally log and become command replies; play has its own background catch. Generic reply helper suppresses reply errors.
- Registration failure has no surrounding catch and prevents later restore/autojoin work in the ready callback. client.login has no rejection catch.
- Synchronous stream setup failure logs and recursively calls playNext(failedTrack), trying queue/autoplay. Player errors announce failure and use onTrackEnd, including repeat. No ordinary bad-track blacklist or bounded retry exists.
- yt-dlp rejection destroys source; player/resource propagation should surface failure/Idle. Nonzero close by itself merely warns. No stalled-stream watchdog or explicit download timeout.
- FFmpeg errors normally destroy output; intentional cancellations/input EPIPE are ignored.
- Voice setup waits 15 seconds, destroys failed connection, clears its reference, and reports signalling/UDP hints. On later Disconnected it waits five seconds for Signalling, otherwise destroys. No dedicated kick/rejoin logic, infinite reconnect, or complete playback cleanup. NoSubscriberBehavior.Play allows audio to progress without a subscriber.
- **Last listener leaving is mishandled:** both voice handlers return unless newState.channel equals the bot channel. Departures have null/another channel, so no empty check. Joins/other updates can resume a manual pause because no pause reason is stored. Duplicate handlers can duplicate notices.
- **Auto-leave is not wired:** scheduleEmptyDisconnect exists but is never called. LEAVE_ON_EMPTY/timeout therefore do not implement effective empty-channel departure. Queue exhaustion remains connected.
- State-load corruption is logged and preserved with saving disabled; per-guild restore errors are generally logged. Graceful signals checkpoint before teardown; crash recovery may lag several seconds.

## 8. Known issues and unfinished behavior

These are source findings or explicitly identified risks, not live reproductions. No TODO/FIXME markers were found. “Legacy support”, “INSTANT MODE” and “CRITICAL FIX” comments mark alternate/partial paths.

1. Playlist/forward have no handlers; pause-track/resume-track are advertised but unreachable. Prefix adapter is incomplete; canonical hyphenated notification command cannot parse.
2. Prefix loop/help validation lowercases only for checking. Uppercase loop is stored incorrectly; uppercase help can dereference an empty category array. Help runs outside the main command try/catch.
3. Search menu embeds full JSON track data as each option value. This can exceed Discord's 100-character select-value limit; descriptions are also unbounded. Search doesn't prefilter duration. Its async selection callback lacks a catch, so add/reply errors escape the original search try/catch.
4. Main limit is 30 minutes while most messages/README claim six. Autoplay alone caps six. Only metadata, not actual downloaded duration, is checked.
5. `format:bestaudio` does not force WebM/Opus, but unfiltered resource assumes WebmOpus. A different selected container/codec can break demuxing; no probing exists. Effects instead transcode through FFmpeg.
6. Duplicate flawed voice listeners, unused empty disconnect timer, weak kick recovery and no same-channel authorization undermine advertised behavior.
7. Skip honors repeat; errors can repeat bad songs. Async Idle/error/command advancement has no concurrency guard, risking overlapping playNext calls and queue consumption.
8. Resume offset can leak: playNext only resets it if endedTrack is non-null or old offset is zero. After a seeked track ends and autoplay exhausts, a later fresh play can reuse an old nonzero offset for a different song.
9. setAudioFilter starts async playNext without await/catch. Replies can precede stream setup. Filters aren't persisted. Nightcore modifies rate/tempo without correcting displayed source position/duration.
10. Spotify's active branch waits for all resolution with up to 45 yt-dlp searches, no timeouts/retries/token cache. One thrown search rejects the batch. Matching is first duration-valid result, not verified song identity. The unused three-worker background branch bypasses add capacity/requester/notification behavior and queues completion order as system.
11. Spotify uses limit=100 for album and playlist endpoints. Acceptance/current API compatibility was not tested; source establishes the request, not external success.
12. Notification channel/filter/count settings aren't saved. Notification setting schedules a save but snapshot omits it. Each add overrides notification destination; dashboard add clears it. Saved guild entries are retained without cleanup. Snapshot validation is shallow; malformed entries can fail before per-restore catches. Queue restoration depends on valid saved voice channel.
13. add connects/moves before rejecting duration/cap violations. A failed request can still move voice.
14. One-second live-card edits can pressure Discord rate limits at scale. Play cards omit requester, showing Unknown; nowplaying supplies it. Empty Spotify matches can cause tracks[0].title errors. No current can cause reply-on-already-deferred problems. Background play startup and card generation can race.
15. Queue embed numbering disagrees with remove/move input. Help formats optional arguments as required, includes nonexistent commands, and its long playback field risks exceeding embed field limits.
16. Health is readiness, not successful voice/audio: it can report playing while buffering or with destroyed connection; dashboard connected checks object truthiness. Public page shows only the first active guild.
17. No guildDelete cleanup, global error/unhandledRejection handler, HTTP server error handler, or built-in dependency/yt-dlp updater. Current upstream maintenance/deprecation status cannot be concluded from local source; no package is asserted formally deprecated here.
18. Prefix, caps, autoplay, search counts, concurrency, filters and intervals are hardcoded. Snapshot text files duplicate code outside runtime. Example voice/server IDs are hardcoded in the template.

Validation: `npm run check` passed all six src files. `npm test` passed **9/9**. Tests cover HTTP/UI syntax/helpers, not live Discord registration/voice, queue progression, streaming codecs, Spotify matching, effects, persistence recovery, or the broken commands above. No live login/playback/deploy was attempted; application code was not changed.

## 9. Full key source code

The entry point contains both GuildMusic and the actual command handler, so it is included once in full. The appendix also includes complete command definitions, music utilities and HTTP backend. UI templates remain in src and are described above. Private .env/cookies are omitted; runtime secret values are not needed to understand these files. Secret-value replacement is applied as a precaution.

### src/index.js

```javascript
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
const { formatYtdlpTime, hasAllowedDuration, resolveSuggestedTrack, searchYouTube, resolvePlaylist, buildGeniusSearchUrl, youtubeCookieOptions } = require("./music-utils");
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
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed
      && this.connection.joinConfig.channelId === channel.id) return this.connection;
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
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
          .catch(() => {
            if (this.connection === connection
              && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
          });
      }
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    } catch (error) {
      const status = connection.state.status;
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
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
        ...youtubeCookieOptions(),
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
    : ".play";
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
      await component.reply({ content: "Run `.q` yourself to control these pages.", ephemeral: true });
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
  // YouTube Music playlist URLs use the same playlist endpoint as YouTube.
  // Check for a list ID before yt_validate(), which can classify a watch URL
  // containing a list parameter as a single video.
  if (/^(?:https?:\/\/)?(?:www\.|music\.)?youtube\.com\//i.test(query)
    && /[?&]list=([a-zA-Z0-9_-]+)/i.test(query)) {
    const playlistTracks = await resolvePlaylist(query);
    if (!playlistTracks.length) {
      throw new Error("No playable tracks up to 30 minutes long were found in that YouTube playlist.");
    }
    if (playlistTracks.length > config.maxQueueSize) {
      throw new Error(`That YouTube playlist exceeds the ${config.maxQueueSize}-track queue limit.`);
    }
    return playlistTracks;
  }

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
    await sendMessage(`Usage: \`.${parsed.name} ${options.map(option => `<${option.name}>`).join(" ")}\``);
    return;
  }
  if (parsed.name === "volume" && !/^(?:[0-9]|[1-9][0-9]|1[0-9]{2}|200)$/.test(argument)) {
    await sendMessage("Volume must be a whole number from 0 to 200. Example: `.volume 80`.");
    return;
  }
  if (parsed.name === "loop" && !["off", "track", "queue"].includes(argument.toLowerCase())) {
    await sendMessage("Repeat mode must be `off`, `track`, or `queue`. Example: `.loop queue`.");
    return;
  }
  if (parsed.name === "help" && argument && !["all", "guide", "playback", "queue", "voice", "settings"].includes(argument.toLowerCase())) {
    await sendMessage("Choose a help category: `all`, `guide`, `playback`, `queue`, `voice`, or `settings`.");
    return;
  }
  if (!options.length && argument) {
    await sendMessage(`This command takes no arguments. Use \`.${parsed.name}\`.`);
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
      // Prefix commands are not Discord interactions; sending a reply to the
      // invoking message fails if it was deleted while the command ran.
      deferredMessage = await message.channel.send({
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

```

### src/commands.js

```javascript
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require("discord.js");

const QUEUE_PAGE_SIZE = 10;

const commands = [
  new SlashCommandBuilder().setName("bassboost").setDescription("Toggle bass boost for the current track."),
  new SlashCommandBuilder().setName("eightd").setDescription("Toggle 8D audio for the current track."),
  new SlashCommandBuilder().setName("nightcore").setDescription("Toggle nightcore mode for the current track."),
  new SlashCommandBuilder().setName("echo").setDescription("Toggle echo for the current track."),
  new SlashCommandBuilder().setName("play").setDescription("Play YouTube searches and YouTube or Spotify tracks, albums, and playlists.")
    .addStringOption(o => o.setName("query").setDescription("YouTube or Spotify link, or search terms").setRequired(true)),
  new SlashCommandBuilder().setName("ping").setDescription("Check the bot's gateway latency."),
  new SlashCommandBuilder().setName("uptime").setDescription("Show how long the bot has been running."),
  new SlashCommandBuilder().setName("pause").setDescription("Pause the track currently playing."),
  new SlashCommandBuilder().setName("resume").setDescription("Resume paused playback."),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track and play the next one."),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue."),
  new SlashCommandBuilder().setName("leave").setDescription("Stop playback and disconnect from voice."),
  new SlashCommandBuilder().setName("queue").setDescription("View the current track and upcoming queue."),
  new SlashCommandBuilder().setName("shuffle").setDescription("Shuffle the tracks waiting in the queue."),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show the track currently playing."),
  new SlashCommandBuilder().setName("volume").setDescription("Set playback volume from 0 to 200 percent.")
    .addIntegerOption(o => o.setName("percent").setDescription("Playback volume percentage").setRequired(true).setMinValue(0).setMaxValue(200)),
  new SlashCommandBuilder().setName("volup").setDescription("Increase volume by 10%."),
  new SlashCommandBuilder().setName("voldown").setDescription("Decrease volume by 10%."),
  new SlashCommandBuilder().setName("loop").setDescription("Choose whether to repeat a track or the queue.")
    .addStringOption(o => o.setName("mode").setDescription("Playback repeat mode").setRequired(true)
      .addChoices({ name: "Off", value: "off" }, { name: "Track", value: "track" }, { name: "Queue", value: "queue" })),
  new SlashCommandBuilder().setName("remove").setDescription("Remove a song from the queue.")
    .addIntegerOption(o => o.setName("position").setDescription("The position of the song to remove").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("forward").setDescription("Fast forward the current track.")
    .addStringOption(o => o.setName("time").setDescription("Time to forward (e.g. 10 or 1:30)").setRequired(false)),
  new SlashCommandBuilder().setName("lyrics").setDescription("Show the currently playing song's lyrics link."),
  new SlashCommandBuilder().setName("move").setDescription("Move a track in the queue.")
    .addIntegerOption(o => o.setName("from").setDescription("Current position").setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName("to").setDescription("New position").setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName("clear").setDescription("Clear the entire queue."),
  new SlashCommandBuilder().setName("search").setDescription("Search for a song and pick the result.")
    .addStringOption(o => o.setName("query").setDescription("Song name").setRequired(true)),
  new SlashCommandBuilder().setName("stats").setDescription("Show bot statistics."),
  new SlashCommandBuilder().setName("playlist").setDescription("Play a YouTube playlist.")
    .addStringOption(o => o.setName("url").setDescription("Playlist URL").setRequired(true)),
  new SlashCommandBuilder().setName("set-notification-channel").setDescription("Set the channel for music notifications.")
    .addChannelOption(o => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("join").setDescription("Connect to the voice channel you are currently in."),
  new SlashCommandBuilder().setName("247").setDescription("Connect to the configured voice channel and stay connected.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()),
  new SlashCommandBuilder().setName("help").setDescription("Browse the command guide by category.")
    .addStringOption(o => o.setName("category").setDescription("Choose a command category")
      .addChoices(
        { name: "All commands", value: "all" },
        { name: "Guide", value: "guide" },
        { name: "Playback", value: "playback" },
        { name: "Queue", value: "queue" },
        { name: "Voice", value: "voice" },
        { name: "Settings", value: "settings" }
      ))
].map(command => command.toJSON());

const helpCategories = [
  { name: "Guide", value: "guide", description: "Browse the command guide and bot status.", commands: ["help", "ping", "uptime", "stats"] },
  { name: "Playback", value: "playback", description: "Search YouTube or play YouTube and Spotify tracks, albums, and playlists.", commands: ["play", "pause", "resume", "pause-track", "resume-track", "skip", "stop", "nowplaying", "lyrics", "forward", "playlist", "bassboost", "eightd", "nightcore", "echo"] },
  { name: "Queue", value: "queue", description: "Review, shuffle, and repeat upcoming tracks.", commands: ["queue", "shuffle", "loop", "remove", "move", "clear", "search"] },
  { name: "Voice", value: "voice", description: "Manage the bot's voice connection.", commands: ["join", "leave", "247"] },
  { name: "Settings", value: "settings", description: "Adjust audio and notifications for this server.", commands: ["volume", "volup", "voldown", "set-notification-channel"] }
];

const commandAliases = {
  p: "play",
  ping: "ping",
  uptime: "uptime",
  pa: "pause",
  r: "resume",
  sk: "skip",
  st: "stop",
  q: "queue",
  sh: "shuffle",
  np: "nowplaying",
  vol: "volume",
  l: "loop",
  rm: "remove",
  ly: "lyrics",
  bb: "bassboost",
  "8d": "eightd",
  nc: "nightcore",
  ec: "echo",
  remove: "remove",
  j: "join",
  lv: "leave",
  h: "help",
  mv: "move",
  cl: "clear",
  sr: "search",
  stt: "stats",
  pl: "playlist",
  sn: "set-notification-channel"
};

const buildHelpEmbed = category => {
  const selectedCategories = category === "all"
    ? helpCategories
    : helpCategories.filter(item => item.value === category);
  const commandByName = new Map(commands.map(command => [command.name, command]));
  const fields = selectedCategories.map(item => ({
    name: item.name,
    value: item.commands.map(name => {
      const command = commandByName.get(name);
      if (!command) return `\`/${name}\` — Command not found`;

      // format: /command <opt1> <opt2> | .alias <opt1> <opt2>' - description
      const slashOptions = command.options?.map(option => `<${option.name}>`).join(" ") || "";
      const prefixOptions = command.options?.map(option => `<${option.name}>`).join(" ") || "";
      const alias = Object.entries(commandAliases).find(([, target]) => target === name)?.[0];

      const slashPart = `\`/${command.name}${slashOptions ? ` ${slashOptions}` : ""}\``;
      const prefixPart = alias
        ? `\`.${alias}${prefixOptions ? ` ${prefixOptions}` : ""}\``
        : `\`.${command.name}${prefixOptions ? ` ${prefixOptions}` : ""}\``;

      return `${slashPart} ${prefixPart} — ${command.description}`;
    }).join("\n"),
    inline: false
  }));

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(category === "all" ? "Music | Command guide" : `Music | ${selectedCategories[0].name}`)
    .setDescription(category === "all"
      ? "Run commands with `/` or use dot shortcuts such as `.p lo-fi beats` or `.q`. Choose a category with `/help category:<category>`."
      : selectedCategories[0].description)
    .addFields(fields)
    .setFooter({ text: "Command options shown in angle brackets are required." })
    .setTimestamp();
};

const buildPlaybackEmbed = ({ user, title, track, queuedCount }) => {
  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(title)
    .setAuthor({
      name: user.globalName || user.username,
      iconURL: user.displayAvatarURL({ size: 128 })
    })
    .addFields(
      { name: "Track", value: (track?.title || "No track is currently playing.").slice(0, 1024) },
      { name: "Artist", value: (track?.author || "Not available").slice(0, 1024), inline: true },
      { name: "When", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
    )
    .setTimestamp();

  if (queuedCount > 1) {
    embed.addFields({ name: "Added", value: `${queuedCount} tracks`, inline: true });
  }
  if (user.displayAvatarURL) {
    embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
  }
  return embed;
};

const requesterLabel = track => {
  const requesterId = track?.requestedById;
  if (requesterId === "dashboard") return "Dashboard";
  if (!requesterId || requesterId === "system") return "Autoplay";
  return `<@${requesterId}>`;
};

const queueTracks = (current, queue, playbackStatus) => [
  ...(current ? [{ ...current, isCurrent: true, playbackStatus }] : []),
  ...queue.map(track => ({ ...track, isCurrent: false }))
];

const buildQueueEmbed = ({ current, queue, playbackStatus, page = 0 }) => {
  const tracks = queueTracks(current, queue, playbackStatus);
  const pageCount = Math.max(1, Math.ceil(tracks.length / QUEUE_PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, pageCount - 1));
  const pageTracks = tracks.slice(currentPage * QUEUE_PAGE_SIZE, (currentPage + 1) * QUEUE_PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("Music queue")
    .setTimestamp()
    .setFooter({
      text: `${tracks.length} track${tracks.length === 1 ? "" : "s"} • Page ${currentPage + 1}/${pageCount}`
    });

  if (!pageTracks.length) {
    embed.setDescription("The queue is empty. Add a song with `/play` or `.play`.");
  } else {
    embed.setDescription(pageTracks.map((track, index) => {
      const number = currentPage * QUEUE_PAGE_SIZE + index + 1;
      const title = (track.title || "Unknown track").replace(/[\r\n]+/g, " ").slice(0, 180);
      const artist = (track.author || "Unknown artist").replace(/[\r\n]+/g, " ").slice(0, 120);
      const label = track.isCurrent ? "NOW PLAYING" : `#${number}`;
      const status = track.isCurrent ? ` · ${track.playbackStatus}` : "";
      return `**${label}**${status}\n**${title}**\n${artist} · Played by ${requesterLabel(track)}`;
    }).join("\n\n"));
  }

  if (current?.thumbnail) embed.setThumbnail(current.thumbnail);
  return embed;
};

const buildQueueComponents = ({ current, queue, page = 0 }) => {
  const pageCount = Math.max(1, Math.ceil(queueTracks(current, queue, "playing").length / QUEUE_PAGE_SIZE));
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("queue:previous")
      .setLabel("◀")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId("queue:next")
      .setLabel("▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount - 1)
  )];
};

const formatDuration = seconds => {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

const buildNowPlayingEmbed = ({
  track,
  elapsedSeconds = 0,
  status = "idle",
  title = "Now playing",
  queuedCount,
  queuedSummary,
  requester
}) => {
  const duration = Number.isFinite(track?.duration) && track.duration > 0
    ? `${formatDuration(elapsedSeconds)} / ${formatDuration(track.duration)}`
    : `${formatDuration(elapsedSeconds)} elapsed`;
  const progress = track?.duration > 0
    ? ` (${Math.min(100, Math.floor(elapsedSeconds / track.duration * 100))}%)`
    : "";

  const embed = new EmbedBuilder()
    .setColor(0x000000)
    .setTitle(title)
    .setAuthor({ name: "Music bot" })
    .addFields(
      { name: "Track", value: track?.title?.slice(0, 1024) || "Nothing is playing." },
      { name: "Artist", value: track?.author?.slice(0, 1024) || "Not available", inline: true },
      { name: "Position", value: `${duration}${progress}`, inline: true },
      { name: "Playback", value: status },
      { name: "Requested by", value: requester || "Unknown", inline: true }
    )
    .setTimestamp(track ? new Date(Date.now() - elapsedSeconds * 1000) : new Date());

  if (queuedSummary) {
    embed.addFields({ name: "Added to queue", value: queuedSummary.slice(0, 1024), inline: true });
  } else if (queuedCount > 1) {
    embed.addFields({ name: "Added to queue", value: `${queuedCount} tracks`, inline: true });
  }
  if (track?.thumbnail) {
    embed.setThumbnail(track.thumbnail);
  }
  return embed;
};

const buildStatsEmbed = (state, uptime) => {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("Bot Statistics")
    .addFields(
      { name: "Queue Length", value: `${state.queue.length} tracks`, inline: true },
      { name: "Total Played", value: `${state.totalTracksPlayed} tracks`, inline: true },
      { name: "Uptime", value: uptime, inline: true }
    )
    .setTimestamp();
};

const parsePrefixCommand = content => {
  const match = content.match(/^\.([a-z0-9]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const input = match[1].toLowerCase();
  return { name: commandAliases[input] || input, args: (match[2] || "").trim() };
};

module.exports = {
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
};

```

### src/music-utils.js

```javascript
const MAX_TRACK_DURATION_SECONDS = 30 * 60;
const MAX_SUGGESTED_TRACK_DURATION_SECONDS = 6 * 60;
const ytdlp = require("youtube-dl-exec");

const youtubeCookieOptions = (file = process.env.YOUTUBE_COOKIES_FILE) =>
  typeof file === "string" && file.trim() ? { cookies: file.trim() } : {};

const hasAllowedDuration = duration =>
  Number.isFinite(duration) && duration > 0 && duration <= MAX_TRACK_DURATION_SECONDS;

const formatYtdlpTime = seconds => {
  const totalMilliseconds = Math.floor(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor(totalMilliseconds / 60_000) % 60;
  const remainingSeconds = Math.floor(totalMilliseconds / 1000) % 60;
  const milliseconds = totalMilliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
};

const normalizeTitle = (title, artistName) => {
  const prefix = `${artistName} - `;
  const withoutArtist = title.toLowerCase().startsWith(prefix.toLowerCase())
    ? title.slice(prefix.length)
    : title;
  return withoutArtist
    .replace(/\s*[\[(]?\s*(?:ft|feat|featuring)\b[\s\S]*$/i, "")
    .replace(/\s*\([^)]*\)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const NON_SONG_TITLE_PATTERN = /\b(?:live(?:\s*stream)?|concert|top\s*\d+|best\s+(?:of|songs?(?:\s+(?:of|from|in)\s+\d{4})?)|greatest\s+hits|playlist|compilation|collection|medley|full\s+album|non[\s-]?stop|mix(?:tape)?|karaoke|reaction|interview|podcast)\b/i;

const isSongResult = result =>
  Boolean(result.url && result.title) &&
  !result.isLive &&
  !NON_SONG_TITLE_PATTERN.test(result.title) &&
  Number.isFinite(result.durationInSec) &&
  result.durationInSec > 0 &&
  result.durationInSec <= MAX_SUGGESTED_TRACK_DURATION_SECONDS;

async function searchYouTube(query, limit = 10, runYtdlp = ytdlp) {
  const resultCount = Math.max(1, Math.min(20, Math.floor(limit) || 10));
  const result = await runYtdlp(`ytsearch${resultCount}:${query}`, {
    dumpSingleJson: true,
    flatPlaylist: true,
    skipDownload: true,
    noWarnings: true,
    quiet: true,
    ...youtubeCookieOptions(),
    ffmpegLocation: require('ffmpeg-static')
  });
  const entries = Array.isArray(result.entries) ? result.entries : [];
  return entries.map(entry => ({
    url: entry.webpage_url || entry.original_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null),
    title: entry.title,
    channel: { name: entry.channel || entry.uploader || entry.creator || "YouTube" },
    durationInSec: Number.isFinite(entry.duration) ? entry.duration : null,
    isLive: entry.is_live === true || (entry.live_status != null && entry.live_status !== "not_live"),
    thumbnails: Array.isArray(entry.thumbnails)
      ? entry.thumbnails
      : entry.thumbnail
        ? [{ url: entry.thumbnail }]
        : []
  })).filter(entry => entry.url && entry.title);
}

async function resolveSuggestedTrack(track, triedUrls, search, artworkFrom) {
  const artist = track.author.split(",")[0].trim();
  if (!artist) return null;
  const endedTitle = normalizeTitle(track.title, artist);
  const candidates = new Map();
  const errors = [];

  for (const query of [`${artist} similar songs`, `${artist} popular songs`]) {
    try {
      const results = await search(query, { limit: 15, source: { youtube: "video" } });
      for (const result of results) {
        const normalized = normalizeTitle(result.title || "", result.channel?.name || "");
        if (!isSongResult(result) || result.url === track.url) continue;
        if (!normalized || normalized === endedTitle || normalized.includes(endedTitle) || endedTitle.includes(normalized)) continue;
        if (!candidates.has(result.url)) {
          candidates.set(result.url, {
            url: result.url,
            title: result.title,
            author: result.channel?.name || artist,
            duration: result.durationInSec,
            thumbnail: artworkFrom(result.thumbnails),
            autoSuggested: true
          });
        }
      }
    } catch (error) {
      errors.push(error);
      console.error(`[autoplay] Search failed for "${query}": ${error.message}`);
    }
  }

  const suggestion = [...candidates.values()].find(candidate => !triedUrls.has(candidate.url));
  if (suggestion) return suggestion;
  if (!candidates.size && errors.length === 2) {
    throw new Error(`Could not search for a suggested song: ${errors.map(error => error.message).join("; ")}`);
  }
  if (candidates.size) {
    console.log(`[autoplay] Tried all ${candidates.size} short suggestions for ${track.title}.`);
  }
  return null;
}

function buildGeniusSearchUrl(title, artist) {
  const clean = value => typeof value === "string"
    ? value
      .replace(/\s*[\[(](?:official\s+)?(?:music\s+)?video[\])]/gi, " ")
      .replace(/\s*[\[(]lyrics?[\])]/gi, " ")
      .trim()
    : "";
  const query = [clean(artist), clean(title)].filter(Boolean).join(" ");
  return `https://genius.com/search?q=${encodeURIComponent(query)}`;
}

async function resolvePlaylist(url, runYtdlp = ytdlp) {
  const result = await runYtdlp(url, {
    dumpSingleJson: true,
    flatPlaylist: true,
    noWarnings: true,
    quiet: true,
    ...youtubeCookieOptions(),
    ffmpegLocation: require('ffmpeg-static')
  });
  const entries = Array.isArray(result.entries) ? result.entries : [];
  return entries.map(entry => ({
    url: entry.webpage_url || entry.original_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null),
    title: entry.title,
    author: entry.channel || entry.uploader || entry.creator || "YouTube",
    duration: Number.isFinite(entry.duration) ? entry.duration : null,
    thumbnail: Array.isArray(entry.thumbnails)
      ? entry.thumbnails[0]?.url
      : entry.thumbnail
  })).filter(entry => entry.url && entry.title && hasAllowedDuration(entry.duration));
}

module.exports = { MAX_TRACK_DURATION_SECONDS, formatYtdlpTime, hasAllowedDuration, isSongResult, resolveSuggestedTrack, searchYouTube, buildGeniusSearchUrl, resolvePlaylist, youtubeCookieOptions };

```

### src/health-server.js

```javascript
const http = require("http");
const { timingSafeEqual } = require("crypto");

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="18" fill="#15121f" stroke="#b49aff" stroke-width="2"/>
  <path d="M32 10 36.8 25.2 52 30l-15.2 4.8L32 50l-4.8-15.2L12 30l15.2-4.8L32 10Z" fill="#d3c2ff"/>
  <circle cx="49" cy="14" r="2" fill="#b49aff"/>
</svg>`;
const MAX_REQUEST_BYTES = 16 * 1024;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload));
}

function isAuthorized(request, token) {
  const authorization = request.headers.authorization || "";
  if (!token || !authorization.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "")) {
    const error = new Error("Content-Type must be application/json.");
    error.statusCode = 415;
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      request.resume();
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    const error = new Error("Request body must be a JSON object.");
    error.statusCode = 400;
    throw error;
  }
}

function createHealthServer({ page, dashboardPage, getStatus, dashboardToken, getDashboard, controlDashboard }) {
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (request.method === "GET" && pathname === "/favicon.svg") {
      response.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(FAVICON);
      return;
    }

    if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(page);
      return;
    }

    if (request.method === "GET" && pathname === "/dashboard") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(dashboardPage);
      return;
    }

    if (request.method === "GET" && (pathname === "/api/health" || pathname === "/healthz")) {
      if (pathname === "/api/health" && (request.headers.accept || "").includes("text/html")) {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        });
        response.end(page);
        return;
      }

      const snapshot = getStatus();
      const ready = snapshot.ready === true;
      const status = ready ? "online" : "starting";
      sendJson(response, ready ? 200 : 503, {
        status,
        bot: status,
        serverCount: ready ? snapshot.serverCount : 0,
        track: ready ? snapshot.track : null
      });
      return;
    }

    if (pathname === "/api/dashboard" || pathname === "/api/dashboard/actions") {
      if (!dashboardToken) {
        sendJson(response, 503, { error: "Website controls are not configured. Set MUSIC_DASHBOARD_TOKEN." });
        return;
      }
      if (!isAuthorized(request, dashboardToken)) {
        sendJson(response, 401, { error: "Enter a valid dashboard access token." });
        return;
      }

      try {
        if (pathname === "/api/dashboard" && request.method === "GET") {
          sendJson(response, 200, await getDashboard());
          return;
        }
        if (pathname === "/api/dashboard/actions" && request.method === "POST") {
          sendJson(response, 200, await controlDashboard(await readJson(request)));
          return;
        }
        response.writeHead(405, { ...JSON_HEADERS, Allow: pathname === "/api/dashboard" ? "GET" : "POST" });
        response.end(JSON.stringify({ error: "Method not allowed." }));
      } catch (error) {
        const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
        if (statusCode === 500) console.error(`[dashboard] ${error.stack || error.message}`);
        sendJson(response, statusCode, {
          error: statusCode === 500 ? "The dashboard request could not be completed." : error.message
        });
      }
      return;
    }

    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
}

module.exports = { createHealthServer };

```
