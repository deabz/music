# nyx project guide

The runtime is CommonJS JavaScript on Node 22.12+. `src/index.js` starts discord.js 14, @discordjs/voice, yt-dlp/FFmpeg audio, persistence, and a Node HTTP server. There is no web framework or build step. Spotify metadata is fetched directly; audio comes from YouTube. dotenv loads private environment configuration.

## Source map

| File | Purpose |
| --- | --- |
| src/index.js | Bot startup, slash dispatch, per-guild music state, voice, query resolution, registration, dashboard controls and shutdown |
| src/commands.js | All 30 slash definitions, grouped help, embeds and queue buttons |
| src/mentions.js | Friendly mention replies with a per-channel cooldown; ignores bots |
| src/playback-position.js | Shared live playback position for snapshots and cards |
| src/music-utils.js | YouTube search/playlists/cookies, duration policy, suggestions and lyric links |
| src/storage.js | Supabase snapshots when configured, otherwise atomic versioned JSON storage |
| src/health-server.js | Public pages and JSON, protected dashboard API, authentication and attempt limits |
| src/health-page.js | Home HTML, CSS, registry-generated slash chips and live playback |
| src/status-page.js | Public status and matching 404, reusing home styling and playback renderer |
| src/dashboard-page.js | Per-tab token unlock, server selection, queue and playback controls |
| src/site-motion.js | Shared vanilla CSS and JS animations, accessibility and reveal fallback |

## Public website

`/` and `/health` serve Home; `/dashboard` serves Music controls; `/status` serves public status. `/healthz` and `/api/health` return no-store JSON with status, bot readiness, server count, uptime, Discord ping, package version, timestamp and an allowlisted active track. Readiness determines HTTP 200/503. HTML clients redirect to `/status`. No active track means the track key is omitted. Unknown GET routes return a matching HTML 404.

Home and status poll every four seconds, interpolating progress each second and freezing when paused. Status uptime ticks locally between polls. Network failure shows an explicit unreachable state. The dashboard polls every five seconds. All pages use local assets, the existing near-black/purple styling and system Inter-style fonts.

## Commands and permissions

Only slash commands dispatch music actions. `/help` groups Playback, Queue, Audio effects and Info; the website generates chips from that same command registry. Guilds, GuildVoiceStates and GuildMessages are the only requested intents. Mentions receive a guide at most once every ten seconds per channel. All music commands are server-only; `/247` defaults to Manage Server permission.

Startup bulk-replaces the existing configured slash scope, using GUILD_ID when set and global registration otherwise. Run `npm start` to register. Historical commands in another scope require separate cleanup in that scope.

## Dashboard security

All dashboard API requests require the configured MUSIC_DASHBOARD_TOKEN in an Authorization bearer header. The server compares fixed-length SHA-256 digests using timingSafeEqual. Invalid attempts are limited per socket address (five failures in sixty seconds, then 429 with Retry-After). No forwarded IP headers are trusted. No configured token means controls are disabled. JSON action bodies are limited to 16 KiB. Unexpected action errors return a generic response. Tokens stay in sessionStorage and are cleared on lock or authentication failure. Use HTTPS for remote access.

## Playback and persistence

Each guild owns its queue, player, resource, connection, volume, repeat mode and filters. Audio position uses the resource's delivered playback duration plus the explicit seek offset; each new stream resets the offset from that track. Pause stops delivered audio time. Restarts preserve the requested seek position. Public status exposes a server name, never a private guild/channel/requester ID.

Snapshots retain current track, queue, position, pause state, volume, repeat mode and voice channel. Supabase is selected only when its URL and secret are configured; otherwise MUSIC_STATE_FILE selects a local JSON file. Failed initial loads disable writes to preserve stored state. Always-on voice requires a host with outbound Discord voice connectivity and persistent recovery storage.

See README.md and .env.example for setup. `npm run check` performs syntax checks; `npm test` runs Node tests. There is no lint or build command. Live Discord audio depends on voice UDP, YouTube availability and permissions; unit tests do not establish those external conditions.
