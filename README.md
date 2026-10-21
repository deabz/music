# Music Bot

A Discord.js 14 music bot with YouTube playback, Spotify track/album/playlist support, queue controls, and an optional 24/7 server-deafened voice connection.

## Setup

1. Install Node.js 22.12 or newer.
2. Copy `.env.example` to `.env` and set `DISCORD_TOKEN`.
3. For Spotify support, create an app at <https://developer.spotify.com/dashboard> and set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
4. Invite the bot with the `bot` and `applications.commands` scopes. Grant View Channel, Connect, Speak, Send Messages, Embed Links, and Use Application Commands. In the Discord Developer Portal, enable the privileged **Message Content Intent** for apostrophe-prefix commands.
5. Run `npm install`, then `npm start`. If the yt-dlp installer reports that Python is missing on Windows, run `$env:YOUTUBE_DL_SKIP_PYTHON_CHECK='1'; npm install; Remove-Item Env:YOUTUBE_DL_SKIP_PYTHON_CHECK` in PowerShell; the downloaded yt-dlp executable does not need Python to run.

Set `GUILD_ID` while developing so slash commands register immediately. Leave it blank for global registration (Discord can take up to an hour to propagate global commands).

## Website music controls

Open `/dashboard` on the bot website to control playback in any server the bot has joined. Set `MUSIC_DASHBOARD_TOKEN` to a long random secret on the bot host to enable access; generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Enter the token on the dashboard to unlock it. It is held only in the current browser tab and sent over the protected API as a bearer token. Use HTTPS whenever the dashboard is reachable outside your machine.

The dashboard can pause/resume, skip or stop playback, seek within the current song, adjust volume/repeat mode, add a YouTube or Spotify song, reorder/remove/shuffle/clear the queue, and connect or disconnect voice. Adding a song requires selecting a voice channel; tracks retain the bot's six-minute duration limit. Public `/api/health` and `/healthz` remain read-only.

## 24/7 voice

Set `VOICE_GUILD_ID` and `VOICE_CHANNEL_ID` plus `AUTO_JOIN_VOICE=true`. The bot joins on startup with `selfDeaf: true` and automatically handles normal Discord voice reconnects. A host that supports an always-on worker is required; sleeping web hosts cannot provide reliable 24/7 voice. The website at `/health` shows whether the bot is online and the active song; `/api/health` displays that same page in a browser and returns JSON to API clients. `/healthz` always returns JSON for monitoring.

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

   Railway supplies `PORT` automatically. In the Discord Developer Portal, enable the Message Content Intent for apostrophe commands; invite the bot with `bot` and `applications.commands` scopes and grant Connect, Speak, Send Messages, and Embed Links.

Playback state is checkpointed periodically and saved on a normal shutdown; after an abrupt crash, the restored position may be a few seconds behind. Without a persistent volume, Railway's filesystem is temporary and playback state will not survive a redeploy.

## Commands

Use `/help` or `'help` for a public, categorized command guide. Choose `all`, `guide`, `playback`, `queue`, `voice`, or `settings` with its optional `category` option. Slash-command responses are public in the channel.

Every slash command also accepts an apostrophe prefix in a server, for example `'play lo-fi beats`, `'pause`, or `'vol 80`. Shortcuts include `'p` (play), `'q` (queue), `'sh` (shuffle), `'vol` (volume), `'pa` (pause), and `'r` (resume); `'ping` and `'uptime` show bot status.

Status: `/ping` or `'ping` shows the Discord gateway latency. `/uptime` or `'uptime` shows how long the bot process has been running.

Playback: `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/nowplaying`, `/bassboost` (or `'bb`), and `/eightd` (or `'8d`). Bass boost and 8D audio apply to the current track without skipping it, and stay enabled for subsequent tracks until toggled off.

Lyrics: `/lyrics` or `'ly` shows the currently playing song and links to its Genius lyrics page. If nothing is playing, the bot says so.

Queue: `/queue`, `/shuffle`, `/loop`.

Voice: `/join`, `/leave`, `/247` (`Manage Server` required).

Settings: `/volume`.

`/play <query>` and `'play <query>` accept YouTube URLs/searches and Spotify track, album, or playlist links such as `https://open.spotify.com/playlist/<id>`. Only tracks with a verified duration of six minutes or less are played; longer and unknown-duration tracks are skipped in Spotify releases or rejected for direct requests. Spotify supplies track metadata and the bot matches each track to YouTube audio; yt-dlp supplies the playable Opus stream. Spotify links require `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.

`/nowplaying` and `'np` post a live card that refreshes playback position every second and shows track artwork when available. `/play` and `'play` use the same live card, labeled with the queue addition. Spotify playlists and albums are paginated up to the configured `MAX_QUEUE_SIZE`.

`/queue` and `'q` show a paginated queue embed with up to 10 tracks per page, the currently playing track, and the Discord account that requested each song. Use the arrow buttons to move between pages; only the person who ran the command can control them.

Playback state is saved in `data/music-state.json` and restored at startup, including the current track position, queue, repeat mode, volume, requester IDs, and voice channel. Set `MUSIC_STATE_FILE` to choose another local file. The host must preserve this file across restarts; use a persistent disk on hosts with ephemeral filesystems.

The bot uses Do Not Disturb presence and listens to the active track title, switching to `'play` when nothing is playing. Pause and resume replies use a dark embed with the requesting user's avatar and the action time.

When the queue runs out after a track finishes, the bot tries distinct YouTube suggestions with verified durations of six minutes or less, moving on if a suggestion cannot be played. `/volume` and `'volume` change the active track immediately as well as setting the level for upcoming tracks.

## Permissions and troubleshooting

The bot must be above any channel restrictions and have Connect/Speak permissions in the target voice channel. If audio fails, check that the host can reach YouTube and that `npm install` completed successfully. Never commit `.env` or your bot token.
