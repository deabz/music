# Music Bot

A Discord.js 14 music bot with YouTube playback, Spotify track/album/playlist support, queue controls, and an optional 24/7 server-deafened voice connection.

## Setup

1. Install Node.js 22.12 or newer.
2. Copy `.env.example` to `.env` and set `DISCORD_TOKEN`.
3. For Spotify support, create an app at <https://developer.spotify.com/dashboard> and set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
4. Invite the bot with the `bot` and `applications.commands` scopes. Grant View Channel, Connect, Speak, Send Messages, Embed Links, and Use Application Commands. Message Content Intent is not required.
5. Run `npm install`, then `npm start`. If the yt-dlp installer reports that Python is missing on Windows, run `$env:YOUTUBE_DL_SKIP_PYTHON_CHECK='1'; npm install; Remove-Item Env:YOUTUBE_DL_SKIP_PYTHON_CHECK` in PowerShell; the downloaded yt-dlp executable does not need Python to run.

If playback logs `Sign in to confirm you’re not a bot`, YouTube is rejecting requests from the host. Provide yt-dlp with a cookies file exported from a browser session signed in to YouTube, then set `YOUTUBE_COOKIES_FILE` to that file's path. For example, use `cookies.txt` locally or `/etc/secrets/cookies.txt` for a Render secret file. At startup, the bot copies it into a private, writable temporary file because yt-dlp saves cookie updates; the original file remains untouched. Playback, searches, and playlists use that temporary copy. Cookies grant access to your account: keep the file private, do not commit it, and rotate it if exposed. Without cookies, playback may remain unavailable from that host.

Set `GUILD_ID` while developing so slash commands register immediately. Leave it blank for global registration (Discord can take up to an hour to propagate global commands).

## Website music controls

Open `/dashboard` on the bot website to control playback in any server the bot has joined. Set `MUSIC_DASHBOARD_TOKEN` to a long random secret on the bot host to enable access; generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Enter the token on the dashboard to unlock it. It is stored only in sessionStorage for the current browser tab and sent in an Authorization bearer header, never a URL. The server compares SHA-256 digests with timingSafeEqual. Five failed authentication attempts per socket IP in one minute block further attempts with HTTP 429 and Retry-After; proxy headers cannot spoof that address. Behind a reverse proxy the limit applies to the proxy address. Every dashboard read and action requires authentication. Locking clears the token and password input. Use HTTPS whenever the dashboard is reachable outside your machine.

The dashboard can pause/resume, skip or stop playback, seek within the current song, adjust volume/repeat mode, add a YouTube or Spotify song, reorder/remove/shuffle/clear the queue, and connect or disconnect voice. Adding a song requires selecting a voice channel; tracks retain the bot's 30-minute duration limit (MAX_TRACK_DURATION_SECONDS). Public `/api/health` and `/healthz` remain read-only.

## 24/7 voice

Set `VOICE_GUILD_ID` and `VOICE_CHANNEL_ID` plus `AUTO_JOIN_VOICE=true`. The bot joins on startup with `selfDeaf: true` and automatically handles normal Discord voice reconnects. A host that supports an always-on worker is required; sleeping web hosts cannot provide reliable 24/7 voice. The home page at `/` (also `/health`) shows live playback. `/status` shows readiness, servers, uptime, ping, and a live track card. `/healthz` and its compatibility alias `/api/health` return pretty JSON with HTTP 200 when ready and 503 otherwise; browsers requesting HTML redirect to `/status`. JSON is never cached. Request `Accept: application/json` for monitoring. Track details appear only when a track is active; private IDs and credentials are excluded.

## Deploying on Railway

1. Push this repository to GitHub and create a Railway project using **Deploy from GitHub repo**. Select the repository and the `main` branch.
2. Set the build command to `YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm ci` and the start command to `npm start`. `railpack.json` installs Python 3 in the runtime image, which yt-dlp needs on Linux. Railway needs no public domain for this bot.
3. Add a Railway Volume mounted at `/data`. Set `MUSIC_STATE_FILE=/data/music-state.json` so queue and playback recovery data survives redeploys.
4. Add these Railway variables:

   - `DISCORD_TOKEN`: a newly generated Discord bot token.
   - `GUILD_ID`: your test server ID (optional, but recommended for immediate slash-command updates).
   - `VOICE_GUILD_ID` and `VOICE_CHANNEL_ID`: the server and voice channel to auto-join.
   - `AUTO_JOIN_VOICE=true`.
   - `MUSIC_DASHBOARD_TOKEN`: a long random secret for protected website controls.
   - `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`: optional, for Spotify links.
   - `MAX_QUEUE_SIZE=2000` and `DEFAULT_VOLUME=80` (optional).

   Railway supplies `PORT` automatically. Invite the bot with `bot` and `applications.commands` scopes and grant Connect, Speak, Send Messages, and Embed Links.

Playback state is checkpointed periodically and saved on a normal shutdown; after an abrupt crash, the restored position may be a few seconds behind. Without a persistent volume, Railway's filesystem is temporary and playback state will not survive a redeploy.

## Commands

Use slash commands in Discord. `/help` groups all 30 commands into Playback, Queue, Audio effects, and Info. Its optional category is `all`, `playback`, `queue`, `effects`, or `info`. Responses are public. Mentioning the bot at the start of a server message shows a short guide, limited to once per channel per ten seconds; other bots are ignored.

- Playback: `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/nowplaying`, `/lyrics`, `/forward`, `/volume`, `/volup`, `/voldown`, `/join`, `/leave`, `/247` (Manage Server required).
- Queue: `/queue`, `/shuffle`, `/loop`, `/remove`, `/move`, `/clear`, `/search`.
- Audio effects: `/bassboost`, `/eightd`, `/nightcore`, `/echo`.
- Info: `/help`, `/ping`, `/uptime`, `/stats`, `/set-notification-channel`.

`/play query:<song or URL>` accepts YouTube searches, videos and playlists, and Spotify tracks, albums and playlists. Verified track duration must be 30 minutes or less. Spotify provides metadata, matched to YouTube audio, and requires Spotify client credentials. `/play` updates the persistent server player panel and `/nowplaying` moves it to the current channel; `/queue` uses ten tracks per page with requester labels and invoker-only paging buttons. `/forward` accepts positive seconds or m:ss (default ten seconds). Effects restart playback at the current position and stay enabled until toggled off.

Slash registration replaces the configured scope automatically on startup: run `npm start`. Set `GUILD_ID` for immediate guild registration, or leave it blank for global registration. Global updates can take time to propagate. No separate deploy command is necessary; any obsolete commands in that same scope are removed by the bulk replacement. Commands registered previously in a different scope must be removed in that scope separately.

Playback state is restored at startup, including the current track position, queue, repeat mode, volume, requester IDs, and voice channel. Set both `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on the host to store snapshots in the existing `music_state` table (`guild_id text primary key`, `state jsonb`, `updated_at timestamptz`). Use a secret key from Supabase Settings > API Keys; keep it private on the bot host. `SUPABASE_SECRET_KEY` takes priority; `SUPABASE_SERVICE_ROLE_KEY` remains supported for existing deployments during migration. Changed snapshots are saved in a batch; failed startup loads disable saving to protect existing state. This works on Render without a persistent disk. Existing JSON files are not automatically migrated.

If either Supabase variable is missing, playback state uses `data/music-state.json` as before. Set `MUSIC_STATE_FILE` to choose another local file. The host must preserve this file across restarts; use a persistent disk on hosts with ephemeral filesystems. Startup logs which backend is selected; Supabase errors do not switch backends automatically.

The bot uses Do Not Disturb presence and listens to the active track title, switching to `/play` when nothing is playing. Pause and resume replies use a dark embed with the requesting user's avatar and the action time.

When the queue runs out after a track finishes, the bot tries distinct YouTube suggestions with verified durations of six minutes or less. Download or audio failures stop playback and preserve the remaining queue, preventing blocked downloads from cycling through repeat or autoplay. `/volume` change the active track immediately as well as setting the level for upcoming tracks.

For YouTube challenge solving, the bot explicitly enables the installed Node runtime and allows yt-dlp to fetch its EJS solver from GitHub. See the [yt-dlp EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS). If Render still reports `HTTP Error 403: Forbidden`, redeploy with a cleared build cache to refresh the yt-dlp binary, then check cookies and the [PO Token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide). Cookies alone do not resolve every host or token restriction. Audio selection prefers WebM Opus and falls back to other audio formats through FFmpeg PCM conversion.

## Permissions and troubleshooting

The bot must be above any channel restrictions and have Connect/Speak permissions in the target voice channel. If audio fails, check that the host can reach YouTube and that `npm install` completed successfully. Never commit `.env` or your bot token.

## Local verification

Run `npm run check` and `npm test`. There is no build or lint script. To use another local port in PowerShell, run `$env:PORT='3001'; npm start`. The site uses vanilla CSS/JavaScript, no external font or animation requests, reduced-motion support, and a reveal fallback after 1.5 seconds.

For real browser checks, install Chromium once with `npx playwright install chromium`, start the site on port 3000, then run `npm run test:website`. Set `NYX_TEST_URL` to test another localhost port. Playwright checks asset responses/cache headers, animated computed styles, long titles, copy feedback, paused playback, song changes, 375px layout, reduced motion, and disabled JavaScript. Screenshots and its JSON report are saved under the ignored `data/website-qa/` directory. Artwork and health fixtures are used for repeatable playback-state tests; normal page loads also use the live local bot. CSS/JS links carry a content hash and development assets use `Cache-Control: no-cache`; restart the Node process after editing page templates or motion sources.


## Local yt-dlp maintenance

Startup logs `[ytdlp] version ...` for the executable selected by `youtube-dl-exec`.
A missing/unreadable version produces a warning and does not prevent startup.
Check it without connecting Discord with `npm run ytdlp-version`.
Update that same executable with `npm run update-ytdlp` (Windows supported).
This updates only the downloader binary, not npm dependencies; stop the bot first.
YouTube changes frequently, so updating yt-dlp is the first thing to try when downloads start failing.


## Playback diagnostics and autoplay

Player, voice, start, end, and failure logs carry UTC timestamps. Failures include the guild,
track, a classified reason, and the last 2,000 characters of downloader stderr in the host log;
Discord receives only the short reason. HTTP 403 gets one automatic retry. Other identified
download errors do not retry; an unexplained audio ending within three seconds retains the
short-stream retry policy. Repeated short-stream failures stop with the remaining queue preserved.
Pipe errors from intentional cancellation are silent. A pipe closure within five seconds of the
expected end is treated as natural completion; earlier closures remain failures.

Next audio is prefetched when the current player reaches Playing, with one speculative pipeline
per server. Its PassThrough uses a 2 MiB high-water mark on each side (roughly 4 MiB plus pipe and
codec overhead). Queued audio uses the same effects, probing, inline volume and downloader options
as normal playback. A small prefix of the actual stream is probed: WebM Opus uses the fast path;
other formats are converted by FFmpeg to 48 kHz stereo signed 16-bit PCM. This reduces transition
latency but cannot guarantee sample-perfect gapless playback or avoid buffering on slow networks.

Autoplay prefers the previous artist/title and channel. Edit `AUTOPLAY_REJECT_KEYWORDS` in
`src/music-utils.js` to change rejection rules for kids content and non-song results. Unrelated
results are rejected even if no alternative remains. These are metadata heuristics, not a genre
classifier. Recent suggestion URLs are tracked in memory for the current session.


## Persistent Discord player panel

Each server has one normal bot message with a gold queue embed, suggestions, and three button rows.
The title counts current plus waiting tracks. The current song is a linked title (about 50 characters),
with its duration on the first line and requester on the second. A separate **Up Next:** section shows
up to ten waiting songs: code-styled positions starting at 1, bold unlinked titles (about 40 characters),
duration, and requester. Extra waiting songs use an "...and N more" line. Autoplay is labelled Autoplay;
the footer shows the bot avatar and volume. Track titles have no decorative prefixes.
Successful `/play` commands post a public **Title** added to the queue or **N tracks** added to the
queue confirmation, with escaped titles and mention notifications disabled. Processing, errors,
permission refusals, effects menus, and favourites menus remain private. A private processing reply
is completed before the public confirmation and then removed; it is never the player message.
The panel is edited in place; `/nowplaying` deletes it and posts a fresh copy in your current channel.
Channel/message IDs are saved in the existing guild snapshot backend and reattached on restart.
Grant the bot View Channel, Read Message History, Send Messages, and Embed Links in the panel channel.
Missing messages are replaced when needed. Updates debounce for 800 ms and serialize per server;
permission failures log once and wait for an explicit command before retrying.

- Play resumes; Pause pauses; Next skips. Previous restarts after five seconds, otherwise returns
  to one of the last 20 completed/skipped tracks and puts the current song back in the queue.
- Loop cycles off, track, queue. Volume changes by 10 within 0-200. Rewind/Forward seek ten seconds.
- Lyrics shows private LRCLIB lyrics without requiring voice access; when idle it opens the song popup. Shuffle changes waiting tracks. Stop clears playback and
  queue but keeps the voice connection and idle panel.
- Effects opens a private multi-select; the chosen set is applied in one restart, keeping position.
- Suggestions reuse autoplay filtering and are cached per track; selecting one queues it as you.
  The menu shows five options by default; edit `PANEL_SUGGESTION_COUNT` in `src/player-panel.js` to
  change the display count. Labels are titles; descriptions are `channel - youtube - mm:ss`, with
  the channel truncated first to preserve the source and time. IDs are short tokens, not URLs.
- Heart adds/removes the current song from your favourites. My favourites opens your private list.

Playback controls require you to currently be in the same voice channel as the bot,
even for server owners, Administrators and members with Manage Server. This includes
pause/resume, previous/next, stop/leave, queue edits, repeat, volume, seeking and
effects. Suggestions, effects submissions and queueing a saved favourite also
re-check your current voice state when selected. Outside-channel refusals are private.

Lyrics, saving/removing favourites with the heart, and browsing My favourites do
not require voice access. Viewing the queue, help, ping, uptime, stats and
`/nowplaying` remains open to everyone in the server.

`/play`, `/join`, `/247` and search selections cannot take over active playback
from someone in another voice channel, including when the caller is an admin.
Idle joining/adding keeps its existing rules. `/247` and
`/set-notification-channel` still require Manage Server. Dashboard token permissions
are unchanged. If voice-state data is unavailable after a restart, controls refuse
until Discord supplies it; a stale member object is never used as an override.
History and suggestion caches are in memory. Favourites are global per user (maximum 25), saved
atomically in `data/favourites.json`, independently of guild state, including when guild snapshots
use Supabase. No database migration is required. A failed favourites load disables writes to protect
existing data. Copy this file when moving PCs; it is not synced to Supabase. Run one bot process.
Markdown in titles is escaped, title mentions are neutralized, and the panel sends no mention notifications. Real Discord appearance and long-lived interaction
behaviour require a manual check; automated tests use synthetic channels and interactions.

### Song lyrics

`/lyrics` finds community-sourced lyrics from LRCLIB for the playing song. Use
`/lyrics song:Artist - Title` or free-text search for another song. When nothing
is playing, a popup asks for the song. No API key or environment variable is needed.
Lyrics may be missing; a Genius search link is offered when no match is found.
Long lyrics have invoker-only Previous/Next buttons lasting 10 minutes (10 pages
maximum). Lookups have a per-user 5-second cooldown. Lyrics are cached only in
memory (100 entries; missing results expire after 10 minutes), never saved to disk.

Slash-command results are visible in the channel. The panel mic button and its
popup results are private to the clicking user. Neither requires joining voice.
Titles and artists are cleaned before matching. Search candidates need at least
80% token similarity for the title and known artist; duration differences within
5 seconds receive preference. Differences exceeding 30 seconds or 25% of the
known duration (whichever is larger) are rejected. Ambiguous matches can still be
wrong; use `Artist - Title` to improve matching. Each request times out after
8 seconds; network failures are not cached. Display uses whole lines, about 3500
escaped characters per page. A single line exceeding that size is omitted with
a truncation notice rather than cut in half.
