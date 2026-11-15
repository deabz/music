# Effects and Idle investigation

## Findings and corrections

| Suspect | Evidence and result |
| --- | --- |
| yt-dlp seek to stdout | Real, reproduced defect at the application boundary. At offset 60, all effect paths ended early with exit code 0 and empty stderr; offset 0 completed. Off also sought inaccurately. The corrected builder downloads the original source and applies `atrim` plus `asetpts` before effects (`src/audio-pipeline.js:107`, `src/audio-pipeline.js:127`). The exact upstream cause remains unproven. See `EFFECTS_DIAGNOSTICS.md` for measurements. |
| FFmpeg discovery / spaces | The executable from ffmpeg-static was already supplied via `ffmpegLocation`, and native spawn receives separate arguments, not a shell command (`src/audio-pipeline.js:107`). Spaces, dollar signs, ampersands, brackets and quotes are not shell syntax here. The title is not passed to the children. No evidence this caused the reported failure. |
| Probe prefix | The real demuxProbe result stream is piped onward; consumed probe bytes are preserved. Tests verify a distinct prefix and later chunks reach FFmpeg once, in order (`src/audio-pipeline.js:120`, `test/audio-pipeline.test.js`). No defect reproduced. |
| Backpressure | The output has a 2 MiB highWaterMark; source-to-FFmpeg and FFmpeg-to-output use Node pipe and its drain handling (`src/audio-pipeline.js:27`, `src/audio-pipeline.js:82`, `src/audio-pipeline.js:144`). The corrected slow-consumer case completes. There is no manual resume/pause loop discarding bytes. |
| FFmpeg graph | Output remains s16le, 48 kHz, stereo. Added `-nostdin`; trimming precedes pitch/tempo so offsets use source time. Bass `bass=g=10`, 8D `apulsator=hz=0.1`, echo `aecho=0.8:0.88:60:0.4`, and their combined graph completed live. Nightcore now normalizes input to 48 kHz before its existing asetrate/atempo stages, keeping the 1.323 position rate consistent across source sample rates (`src/audio-pipeline.js:124`). |
| Old Idle / errors | Real application defect. Idle originally had no originating-resource check. The callback now supplies the old resource; onTrackEnd rejects obsolete resources/generations. Pipeline activation and failure callbacks also check the active job and generation (`src/index.js:188`, `src/index.js:585`, `src/index.js:745`). |
| Delayed process-tree kill | A replacement could previously start before Windows taskkill finished. Cancellation now exposes its termination promise and replacement activation awaits it, with a generation check after waiting. Late failure fallbacks do not kill an already closed child (`src/audio-pipeline.js:11`, `src/index.js:533`, `src/index.js:555`). |
| Intentional abort | The cancellation flag is set before destroying streams/killing children; genuine errors no longer become intentional merely because failure cleanup called cancel (`src/audio-pipeline.js:57`). Current is cleared before intentional stop during replacement. Intentional aborts are not resumed. |
| Prefetch filters | Filter replacement invalidates/cancels prefetch and explicit track replacement never reuses it (`src/index.js:226`, `src/index.js:466`, `src/index.js:543`). This was already structurally correct; regression tests retain coverage. |
| Early EOF / retry | Real application defect: clean child EOF was accepted as natural even if far before metadata duration. It now resumes from delivered audio time at most twice per track instance, without incrementing failed-song counters (`src/index.js:634`, `src/index.js:642`, `src/index.js:745`). The existing 403 retry precedes this safety net. Private/unavailable/sign-in/format failures and rate limits are excluded. Existing short-stream fallback remains after bounded resumes. |
| Permanent classification | `This video is private` was not matched by the older private-video pattern. It is now classified unavailable so it cannot enter the resume loop (`src/playback-errors.js:7`). |
| Effects command timeout | Real defect: the four slash effect handlers originally replied after restart completion. They now defer first. Slash and panel restart controls share a guard that is claimed before awaiting acknowledgement, preventing duplicate clicks (`src/index.js`, `src/panel-interactions.js:37`). |
| Effects failure rollback | The previous restart path swallowed the error and stopped the song. Restart now waits for actual output, reports failure, restores previous filters and saved position, preserves pause and queue, and retains a late-failure rollback context. Only failure of recovery falls back to normal stopping (`src/index.js:226`, `src/index.js:262`). |
| Fade timers | Fades only change resource volume; they neither end nor destroy audio. Cleanup cancels their wake-up. A captured-resource check also prevents an already queued old callback from refreshing a replacement (`src/transitions.js:79`). |
| yt-dlp ending / HTTP errors | A failed downloader cancels the graph so partial buffered data cannot masquerade as a successful complete song. Logs retain both stderr tails and known exit codes. Recoverable early errors enter bounded recovery; permanent failures retain normal handling (`src/audio-pipeline.js:38`, `src/index.js:681`). |
| Missing diagnostics | The previous detail selection preferred yt-dlp stderr and omitted FFmpeg stderr, often leaving an unknown classification. Failures now combine both streams and error text for classification and log staged, redacted diagnostics. Child-close callbacks add later-known exit information (`src/playback-errors.js:18`, `src/index.js:681`). |

## Verification and limits

Automated regression tests cover acknowledgement order, menu selection, rollback,
pause/position preservation, old callbacks, process-tree termination waits, byte
preservation, every filter combination at offsets 0/60, bounded resumes, permanent
failures, stop cancellation, one summary per pipeline and redacted diagnostic fields.
The public-URL reproducer independently verifies the corrected seek graph with actual
yt-dlp and FFmpeg. No bot login or real Discord command was run.

Manual Discord checks remain: toggle bass boost, then nightcore, then echo, then all
off around 20 seconds; try the Boom song; repeat while paused and near the end; enable
effects before playback; double-click the menu; confirm exactly one restart and the
panel remains current. Listen for timestamp accuracy and audible continuity.

Risks: seeking must download/decode preceding audio and can take longer or reach the
30-second first-audio deadline on a slow host. Incorrect duration metadata can provoke
two unnecessary resumes. A rollback can replay from the original saved toggle/seek
position. Windows termination must complete before the replacement starts. Log exit
codes are null when unavailable/not yet exited; later failure diagnostics include
known closes. YouTube may still block downloads (one corrected diagnostic got 403).
