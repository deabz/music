# Render preparation verification

## Phase 1

Local Node v24.19.0 on Windows; package engines requires >=22.12.0. All 221 tests
and npm run check passed initially. No baseline regression or flaky failure found.
The Docker target is Node 22; a real Linux image build remains unverified locally
because Docker is not installed. Existing configured Git identity was retained.

No Discord login, bot startup, protected-file access, dependency install/update or
dependency-directory modification was performed during this preparation.

## Phase 2 real smoke results

yt-dlp 2026.10.26 and FFmpeg 6.1.1 both execute. Search returned five Never Gonna
Give You Up uploads (durations 213-214 seconds) in 8.666 seconds. No verified small
public playlist was identified; the playlist smoke was skipped, with helper coverage
retained in unit tests. Command definitions: 30, zero offline registration violations.

Lyrics: Rick Astley / Never Gonna Give You Up matched (0.257 s); free text Michael
Jackson - Billie Jean matched (0.071 s); nonsense query not found (0.069 s). No lyric
text was printed. Spotify, Supabase and authenticated Discord remained mock-only.

| Pipeline case | PCM seconds / target | Source seconds | Wall seconds | Result |
| --- | --- | ---: | ---: | --- |
| Off | 15 / 15 | 15 | 39.159 | Sample complete |
| Bass boost | 15 / 15 | 15 | 37.458 | Sample complete |
| 8D | 15 / 15 | 15 | 37.177 | Sample complete |
| Nightcore | 15 / 15 | 19.845 | 29.907 | Sample complete |
| Echo | 15 / 15 | 15 | 36.072 | Sample complete |
| All | 15 / 15 | 19.845 | 28.972 | Sample complete |
| Offset 60, off | 15 / 15 | 15 | 35.795 | Sample complete |
| Offset 60, all | 15 / 15 | 19.845 | 31.497 | Sample complete |

Each used the real builder and a roughly real-time PCM consumer (Opus was decoded
for measurement). All stopped intentionally at the sample cap, with empty stderr;
nonzero Windows child exits after taskkill reflect cancellation, not playback errors.
No early EOF or stream error occurred during these samples. The OS process list
contained zero surviving owned smoke children after cleanup. These are samples,
not a full-song or Discord voice test. An initial smoke driver over-counted queued
output after cancellation; the corrected bounded driver was rerun for every case.

Real local HTTP module: /, /health, /healthz, /commands, /changelog, /status,
/api/health, /api/now-playing, /api/commands, /site.css, /site.js, /favicon.ico,
/favicon.svg, /site.webmanifest, /robots.txt, /changelog.json and /dashboard returned
200 with a ready stub. Unknown path returned 404. Dashboard API/actions returned
503 without configuration; configured unauthenticated API returned 401; authorized
API and POST action returned 200. Servers closed cleanly. JSON storage round-trip
in a private temporary directory passed. Real upstream status and audible voice
still require manual verification.

Registration limits were checked against Discord's application-command documentation:
https://docs.discord.com/developers/docs/interactions/slash-commands

## Phase 3 Linux/Render audit

Dockerfile targets node:22-bookworm-slim, installs Python 3, CA certificates and tini,
uses npm ci during image build only, and runs unprivileged. No dependency install or
update was run on this PC. Docker is absent, so no Docker build or live Linux run
was possible. The installed youtube-dl-exec postinstall was inspected read-only:
Unix selects the yt-dlp asset without .exe, Windows selects yt-dlp.exe; postinstall
downloads and chmods it executable. The Unix yt-dlp asset needs Python; Bookworm's
Python 3 satisfies that runtime requirement. Node's explicit js-runtimes option is
shared by all YouTube calls. Relevant upstream implementation:
https://github.com/microlinkhq/youtube-dl-exec/blob/master/scripts/postinstall.js

Linux pipeline children already spawn detached; cancellation kills their negative
PID process group, with individual-child fallback. Windows keeps taskkill tree
cancellation and awaits termination before replacement. Platform-mocked tests cover
both. Read-only Secret File copying is covered by a mocked Linux filesystem test,
plus an actual temporary read-only source test on Windows; Linux permission behavior
remains unverified on this PC. Docker/shell LF rules are enforced by .gitattributes.

YTDLP_PROXY is included in shared runtime options and tool calls. Proxy/cookie values
are redacted from structured failures and generic metadata errors. The new voice
readiness diagnostic distinguishes the working gateway from a failed voice transport.
render.yaml uses Docker, /health and private sync:false fields; Render supplies PORT.

## Phase 4 real standalone self-test

The restricted-sandbox first attempt received Windows socket error 10013. The
classifier was corrected so an OS permission error is network, not YouTube 403.
The authorized unrestricted rerun produced this single block (cookies disabled,
without reading protected files). Python is unnecessary for the Windows .exe;
Python 3 is installed in the Linux image. UDP success here is only a return-path
hint on this PC and says nothing definitive about Render/Discord voice.

```text
[diagnostics] node: v24.19.0 win32
[diagnostics] bot: 1.0.0 commit ada9098
[diagnostics] yt-dlp: OK 2026.10.26
[diagnostics] ffmpeg: yes ffmpeg version 6.1.1-essentials_build-www.gyan.dev Copyright (c) 2000-2023 the FFmpeg developers
[diagnostics] python3: no unavailable (informational)
[diagnostics] YOUTUBE_COOKIES_FILE configured: no
[diagnostics] YTDLP_PROXY configured: no
[diagnostics] udp: 1.1.1.1=reply 8.8.8.8=reply (hint only; does not verify Discord voice UDP)
[diagnostics] gateway: HTTP 200
[diagnostics] youtube: OK (search=3 audio=262144 bytes)
[diagnostics] summary: youtube=OK ytdlp=OK ffmpeg=OK udp=hint-OK
```

Startup invokes diagnostics without awaiting it after ClientReady. Checks have a
60-second overall bound, and mock tests cover unavailable tools, cancellation,
timeouts, once-only scheduling, disabled configuration and secret redaction.
