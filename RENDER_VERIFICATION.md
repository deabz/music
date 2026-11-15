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

## Phase 5 documentation and portability

README now lists Docker service settings, every bot environment variable, Secret
Files, monitoring, ephemeral storage, memory and network limits. The live checklist
has 29 steps covering all commands and panel controls, permissions, effects,
transitions, repost and recovery. FEATURE_TEST_MATRIX.md distinguishes automated
definitions/helpers from actual network smoke results and live-only interactions.

All remaining static PNG/icon/Open Graph routes were requested using the real HTTP
module and real page exports: every route returned 200. Finalized smoke scripts were
deleted from the OS temp folder. No owned yt-dlp/FFmpeg smoke children remained.
Tracked text was checked for machine-local Windows paths and the local username;
four files were sanitized (three synthetic-path fixtures and the asset generator).
The generator now uses portable DejaVu font names rather than a Windows font path.
The earlier effects reports already used relative source references and contained
no machine-local username/path. All 234 tests and source checks pass at this stage.

## Outstanding gate investigation (2026-11-15)

No merge, push, rebase or history rewrite was performed. Potential matched values
were examined privately in memory; this report and scanner output contain only
metadata. No genuine credential was identified. No rotation is warranted by the
reviewed findings. If a future finding is confirmed genuine, stop release, reset
it at the provider, replace deployment configuration, review access, and obtain
explicit approval before any history remediation. None of those actions was taken.

### Original findings

| File | Revision | Match type | Investigation and disposition |
| --- | --- | --- | --- |
| test/health-server.test.js | working tree | Generic Bearer literal | Localhost-only invalid authorization fixtures; assertions require 401/429 and no control execution. Replaced with generated runtime fixtures. |
| test/health-server.test.js | 8f7b5556c6ddae07b03eca3d4071ad9b5c4116fe | Generic Bearer literal | Same harmless local HTTP fixtures; exact file fingerprint, line and rule reviewed. History preserved. |
| test/health-server.test.js | 74ca3cf5e69e6688518e794554dfe51693217ae6 | Generic Bearer literal | Same harmless local HTTP fixtures; exact file fingerprint, line and rule reviewed. History preserved. |
| .env.example | d9b130d956f37d3dc890c2ae4fbc6ced207db850 | Credential assignment | Human instruction placeholder, no credential structure. |
| .env.example | 3264661403b510b4449a5d1aca003bb4d86598b5 | Credential assignment | Human instruction placeholder, no credential structure. |
| .env.example | 39b599250909dbc3338b59433722a97cdd8174fb | Credential assignment | Human instruction placeholder, no credential structure. |
| .env.example | 659c70d14539ab8bb49a89bb0ae712b0805c753e | Credential assignment | Human instruction placeholder, no credential structure. |
| .env.example | 6f2a647fa37fa0ccfb5656710c45647ef12db836 | Credential assignment | Human instruction placeholder, no credential structure. |

The current .env.example has only comments and empty settings, verified by a test.
The five historical instruction values match anchored placeholder syntax rather
than an unrestricted substring exemption. Historical findings remain visible as
reviewed evidence; no commits or files were removed to satisfy the scanner.

### Additional findings and remediation

The expanded scan also reviewed valid localhost-only HTTP authentication fixtures
in the two original test revisions and ff91af69f37dc75bf4c35565eddc4ccc2825b81c
and ab4ce9a3307885c3ae143cb5c7e72f19595c0ac1. Their values match the credential
configured for the same in-process stub server. Current tests now generate both
valid and invalid credentials at runtime, preserving success, denial and rate-limit
coverage. Production authentication and playback code were not changed.

Two earlier templates contain replacement instructions: music-bot/.env.example at
9d6d6c37ebdcdc2251165797655297ac657f88d8 and .env.node.example at
a5f6fee141e463861db9db1952b7db64f790705d. These are exact-content reviewed
placeholder findings. src/spotify.js uses a runtime Bearer interpolation, with no
embedded credential; the scanner recognizes its syntactic runtime reference.

Added npm run scan:secrets with value-free metadata output. It scans tracked and
nonignored untracked working files, and all reachable Git blobs, commits and tags
across all refs. Protected tracked paths and protected path history fail closed
before content scanning; actual .env and cookies.txt were not read. Exceptions for
historical fixtures/templates require matching path, LF-normalized whole-file
SHA256, line and generic rule. Structured Discord tokens, Supabase keys, JWTs,
cookie lines and private keys are never exempted. Changed content invalidates a
review. Pattern scanning is evidence, not proof that arbitrary secrets cannot exist.

### Verification and remaining release gates

| Gate | Result |
| --- | --- |
| Complete tests | PASS: 241 tests, zero failures/skips; original 234 preserved plus seven scanner regression tests. |
| npm run check | PASS: UTF-8 and source syntax checks. |
| Working-tree/full-history secrets | PASS with documented reviews; no unresolved candidates or scanner errors. Initial reviewed scan covered 127 commits and 604 content objects; the final local commit adds its own objects. |
| Protected files | PASS: no protected tracked paths or .env/cookies.txt/data path history. |
| Attribution | PASS: no attribution matches in origin/main..main or origin/main..render-ready commit bodies. |
| Remote | https://github.com/deabz/music.git; gh reports PUBLIC. Future publication requires explicit approval. |
| Fast-forward compatibility | PASS against local main: main is an ancestor of render-ready. No merge performed; remote freshness was not established by fetching. |
| Docker/Linux execution | UNVERIFIED: Docker/Podman not installed; WSL returned no installed distribution. Existing static review and mocked Linux tests remain the available evidence. |
| Completed phases | All five phase commits remain ancestors: c0e3f71, 86379e2, ada9098, 01dd9f6, 81621b2. Existing Docker, Render, diagnostics, smoke results and live-checklist work retained. |
| Live Discord/Render | UNVERIFIED; prior smoke results above were retained, not rerun or represented as new live verification. |

Release readiness: the secret false-positive blocker is resolved through explicit,
scoped review without rewriting history. Public publication approval and Linux
image/runtime validation remain outstanding. Nyx is not yet fully release-verified.
The branch is locally fast-forward compatible, but no merge or push is authorized
in this task. Review final Git status and commit identity with the accompanying
summary. No dependency, node_modules, protected secret file, or bot runtime changes
were made during this investigation.

## Release execution follow-up (2026-11-15)

Starting point: clean render-ready at dcae04e6407524c4b6ea1bd9d5b89bb04f84c48b.
The prior authorised push published that branch; the public repository is approved
for this work. Main is not a deployment/push target. No protected secret files were
loaded, and no local dependencies were installed or modified.

### Issues found and changes

* The Blueprint omitted its branch, leaving a newly created service liable to use
  the repository's default main branch instead of verified render-ready. Set the
  explicit branch and added a regression test.
* No repeatable clean Linux/Docker verification existed. Added the Release
  verification workflow for Ubuntu with Node 22 and 24, full-history scanning,
  production Docker build and an unprivileged offline image smoke test. The
  workflow receives no deployment credentials and cannot write repository contents.
* Added test:runtime: real yt-dlp/FFmpeg executables, real stereo WebM probing,
  all effect graphs, 60-second trimming, Opus encoding, DAVE loading, crypto,
  temporary JSON storage and public HTTP/readiness. A synthetic FFmpeg source
  substitutes only the network extractor. This is not a real YouTube or voice test.
* Added verify:discord with read-only REST checks and five regression tests. It
  checks bot/application identity, guild installation, guild permissions and
  registered command names, with no token/error-body output. It never registers
  commands, loads dotenv, logs into the gateway or joins voice. Incomplete checks
  exit nonzero rather than claiming success.

### Commands executed locally

| Command | Actual result |
| --- | --- |
| git status --short --branch; git log -1 | Clean render-ready at the starting revision. |
| gh repo view --json nameWithOwner,isPrivate,defaultBranchRef | Public deabz/music, default branch main. |
| gh workflow list | No existing workflows at initial inspection. |
| Get-Command docker,podman,wsl,gh,ssh; wsl --list --quiet | No Docker/Podman; WSL returned no distribution. |
| npm test | Baseline 241 passed; after changes 247 passed, zero failures/skips. |
| npm run check | PASS, including new scripts and module syntax/UTF-8. |
| npm run test:website | PASS: 14 reported browser scenarios, dark/light at 320/390/1280 widths, all pages, controls, responsive layout, privacy, reduced motion and no JavaScript. Zero unexpected console errors; ten expected HTTP diagnostics. Screenshots stayed in OS temp. |
| npm run test:runtime | PASS: eight pipeline combinations, executable/codecs, JSON and HTTP. No network/Discord. |
| npm run selftest | PASS on Windows: Node v24.19.0; yt-dlp 2026.10.26; FFmpeg 6.1.1; gateway HTTP 200; search=3/audio=262144 bytes; both UDP DNS replies. Python unavailable (informational on Windows). Cookies/proxy unconfigured. |
| node -e (scanRepository metadata summary) | Working-tree and full-history scan PASS, no unresolved findings/errors. Scanner rules unchanged. |
| npm run verify:discord -- --application-id 1552484084243234848 --guild-id 1114203697619152926 | PENDING, exit 1: DISCORD_TOKEN absent. No request or login attempted. |

The runtime harness initially used a mono source and incorrectly expected the
stereo fast path; it was corrected to generate stereo. An initial resource-end
wait was also replaced with explicit Opus encode verification. These were harness
issues, not bot defects. Completed runs check close events and cancel child jobs.

### Authorised live setup and limitations

Application/bot ID: 1552484084243234848. Test guild: 1114203697619152926.
These are identifiers, not credentials. Installation and permissions are NOT yet
confirmed; the process has no DISCORD_TOKEN. Supply it securely to the verification
process, then use the read-only command above. On the actual bot host, set GUILD_ID
to the test guild for immediate test registration. OAuth scopes: bot and
applications.commands. Requested intents are Guilds, GuildVoiceStates and
GuildMessages; the new offline test verifies them. Privileged Message Content and
Guild Members are not requested. Channel overwrites and audible voice still need
the designated text/voice channels and the live checklist. The user explicitly
withheld live validation until authorised access exists; no substitute account,
guessed token, protected file or second bot instance was used.

Render live validation is PENDING: no service ID/URL or authorised access exists.
Required identifiers: service ID (srv-...), public HTTPS URL, deployed branch and
revision. Required runtime secret: DISCORD_TOKEN. Optional features need
MUSIC_DASHBOARD_TOKEN, SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET,
SUPABASE_URL with SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY),
YTDLP_PROXY, and a Secret File referenced by YOUTUBE_COOKIES_FILE. PORT is provided
by Render; AUTO_JOIN_VOICE=false is safe until VOICE_GUILD_ID/VOICE_CHANNEL_ID are
configured. README lists every optional tuning variable and setup instructions.

Use the dashboard to confirm Docker runtime, ./Dockerfile, render-ready, PORT and
normal npm start image command; inspect runtime diagnostics with secret values
hidden. /health is HTTP liveness, not bot readiness; /healthz JSON must become 200
after ready and returns 503 offline. Supabase's music_state table/schema and live
read/write connectivity remain unverified. JSON storage was exercised for real.
Ephemeral disk/favourites loss, host UDP restrictions, YouTube datacenter blocking
and free-tier memory remain deployment risks. No cost-bearing service was created.

Hosted Linux/Docker execution results will be recorded after the workflow runs.
Until then they remain pending, rather than inferred from the Windows results.
