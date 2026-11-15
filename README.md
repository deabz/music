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

`/play query:<song or URL>` accepts YouTube searches, videos and playlists, and Spotify tracks, albums and playlists. Verified track duration must be 30 minutes or less. Spotify provides metadata, matched to YouTube audio, and requires Spotify client credentials. `/nowplaying` and `/play` show live track cards; `/queue` uses ten tracks per page with requester labels and invoker-only paging buttons. `/forward` accepts positive seconds or m:ss (default ten seconds). Effects restart playback at the current position and stay enabled until toggled off.

Slash registration replaces the configured scope automatically on startup: run `npm start`. Set `GUILD_ID` for immediate guild registration, or leave it blank for global registration. Global updates can take time to propagate. No separate deploy command is necessary; any obsolete commands in that same scope are removed by the bulk replacement. Commands registered previously in a different scope must be removed in that scope separately.

Playback state is restored at startup, including the current track position, queue, repeat mode, volume, requester IDs, and voice channel. Set both `SUPABASE_URL` and `SUPABASE_SECRET_KEY` on the host to store snapshots in the existing `music_state` table (`guild_id text primary key`, `state jsonb`, `updated_at timestamptz`). Use a secret key from Supabase Settings > API Keys; keep it private on the bot host. `SUPABASE_SECRET_KEY` takes priority; `SUPABASE_SERVICE_ROLE_KEY` remains supported for existing deployments during migration. Changed snapshots are saved in a batch; failed startup loads disable saving to protect existing state. This works on Render without a persistent disk. Existing JSON files are not automatically migrated.

If either Supabase variable is missing, playback state uses `data/music-state.json` as before. Set `MUSIC_STATE_FILE` to choose another local file. The host must preserve this file across restarts; use a persistent disk on hosts with ephemeral filesystems. Startup logs which backend is selected; Supabase errors do not switch backends automatically.

The bot uses Do Not Disturb presence and listens to the active track title, switching to `/play` when nothing is playing. Pause and resume replies use a dark embed with the requesting user's avatar and the action time.

When the queue runs out after a track finishes, the bot tries distinct YouTube suggestions with verified durations of six minutes or less. Download or audio failures stop playback and preserve the remaining queue, preventing blocked downloads from cycling through repeat or autoplay. `/volume` change the active track immediately as well as setting the level for upcoming tracks.

For YouTube challenge solving, the bot explicitly enables the installed Node runtime and allows yt-dlp to fetch its EJS solver from GitHub. See the [yt-dlp EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS). If Render still reports `HTTP Error 403: Forbidden`, redeploy with a cleared build cache to refresh the yt-dlp binary, then check cookies and the [PO Token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide). Cookies alone do not resolve every host or token restriction. Audio selection is restricted to WebM Opus to match the voice player's declared input format.

## Permissions and troubleshooting

The bot must be above any channel restrictions and have Connect/Speak permissions in the target voice channel. If audio fails, check that the host can reach YouTube and that `npm install` completed successfully. Never commit `.env` or your bot token.

## Local verification

Run `npm run check` and `npm test`. There is no build or lint script. To use another local port in PowerShell, run `$env:PORT='3001'; npm start`. The site uses vanilla CSS/JavaScript, no external font or animation requests, reduced-motion support, and a reveal fallback after 1.5 seconds.

For real browser checks, install Chromium once with `npx playwright install chromium`, start the site on port 3000, then run `npm run test:website`. Set `NYX_TEST_URL` to test another localhost port. Playwright checks asset responses/cache headers, animated computed styles, long titles, copy feedback, paused playback, song changes, 375px layout, reduced motion, and disabled JavaScript. Screenshots and its JSON report are saved under the ignored `data/website-qa/` directory. Artwork and health fixtures are used for repeatable playback-state tests; normal page loads also use the live local bot. CSS/JS links carry a content hash and development assets use `Cache-Control: no-cache`; restart the Node process after editing page templates or motion sources.
