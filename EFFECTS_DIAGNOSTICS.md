# Cookie-free effects diagnostic, 2026-11-15

The temporary scripts reused `src/audio-pipeline.js`, the installed yt-dlp and
FFmpeg, and only https://www.youtube.com/watch?v=dQw4w9WgXcQ as the media URL.
They did not load dotenv, prepare cookies, log in to Discord, or modify dependencies.
The no-effect Opus output was demuxed/decoded with the installed prism-media decoder
for measurement; existing raw PCM output was measured directly. A Writable consumer
delayed each chunk by its duration at 192000 bytes/second; the deliberately slow
consumer used 96000 bytes/second. Backpressure remained enabled. Windows scheduling
and decoding overhead made some runs slower than their nominal audio duration.

Expected duration was 213 seconds, confirmed by complete position-zero runs; a
60-second seek should deliver about 153 source seconds. Nightcore output duration
is multiplied by the pipeline's 1.323 playback rate to compare source time.
Small codec/filter tail differences are expected. All runs below consumed to EOF.

## Before the seek correction

| Effects | Start | PCM seconds | Source seconds | Wall seconds | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Off | 0 | 213.040 | 213.040 | 341.648 | Complete |
| Bass boost | 0 | 213.043 | 213.043 | 331.810 | Complete |
| 8D | 0 | 213.043 | 213.043 | 336.254 | Complete |
| Nightcore | 0 | 161.015 | 213.022 | 191.255 | Complete after rate correction |
| Echo | 0 | 213.103 | 213.103 | 331.522 | Complete with effect tail |
| All | 0 | 161.059 | 213.082 | 190.500 | Complete after rate correction |
| Off | 60 | 162.980 | 162.980 | 266.338 | About 10 seconds too long: inaccurate seek |
| Bass boost | 60 | 50.334 | 50.334 | 89.937 | Early: expected 153 |
| 8D | 60 | 50.334 | 50.334 | 89.493 | Early: expected 153 |
| Nightcore | 60 | 56.910 | 75.291 | 72.329 | Early: expected 153 |
| Echo | 60 | 50.394 | 50.394 | 90.106 | Early: expected 153 |
| All | 60 | 56.979 | 75.383 | 73.468 | Early: expected 153 |
| All, slow consumer | 60 | 47.631 | 63.016 | 113.435 | Early: expected 153 |

Every baseline run ended through EOF with yt-dlp exit code 0 and no signal.
Every effects FFmpeg also exited 0 with no signal. Both captured stderr tails were
empty in every baseline case. Off used the Opus fast path, with no pipeline FFmpeg.
Therefore an exit code of 0 does not prove that the entire remaining song arrived.

## After local decoded-audio trimming

yt-dlp now downloads the original stream. FFmpeg trims at source time with
`atrim=start=60,asetpts=PTS-STARTPTS` before the effect filters, rather than asking
yt-dlp for a download-sections range on stdout.

| Effects | Start | PCM seconds | Source seconds | Wall seconds | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Off, initial attempt | 60 | 0 | 0 | 14.502 | YouTube HTTP 403; no audio verification |
| Off, separate retest | 60 | 153.050 | 153.050 | 247.660 | Complete |
| Bass boost | 60 | 153.050 | 153.050 | 243.318 | Complete |
| 8D | 60 | 153.050 | 153.050 | 243.308 | Complete |
| Nightcore | 60 | 115.666 | 153.026 | 134.332 | Complete after rate correction |
| Echo | 60 | 153.110 | 153.110 | 243.116 | Complete with effect tail |
| All | 60 | 115.715 | 153.091 | 134.637 | Complete after rate correction |
| All, slow consumer | 60 | 115.715 | 153.091 | 255.106 | Complete after rate correction |

All seven successful corrected runs ended through natural EOF; both child exit codes
were 0, signals were null, and both stderr tails were empty. The blocked Off run
had yt-dlp exit code 1 and stderr `ERROR: unable to download video data: HTTP Error
403: Forbidden`; FFmpeg was cancelled (Windows exit code 3199971767), with empty stderr.
This failure is distinguished from the original silent truncation.
The separate Off retest completed without cookies or any other workaround.

The experiments isolate the problematic download-sections/stdout/second-FFmpeg
boundary. They do not prove the exact upstream yt-dlp or FFmpeg implementation
mechanism, and they do not reproduce Discord Idle events or the original Boom URL.
The last small code refinements (waiting for process-tree termination and normalizing
nightcore input to 48 kHz) were verified with fake-process regression tests; the live
corrected runs used the local-trim graph before those refinements.
All three throwaway scripts were removed from the OS temp folder after completion;
none of their source was written into or committed to this repository.
