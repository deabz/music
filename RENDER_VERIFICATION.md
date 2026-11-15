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
