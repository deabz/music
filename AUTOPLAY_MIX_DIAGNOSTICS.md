# YouTube Mix feasibility, 2026-11-15

Cookie-free temporary script, installed youtube-dl-exec, project runtime/FFmpeg
options, flat playlist JSON extraction, skip-download, 20-second timeout, and a
25-entry cap. No dotenv, cookies, audio downloads or Discord login were used.

| Seed | URL form | Seconds | Entries | Result |
| --- | --- | ---: | ---: | --- |
| dQw4w9WgXcQ | watch?v=ID&list=RDID | 11.674 | 25 | Works |
| dQw4w9WgXcQ | playlist?list=RDID | 10.343 | 0 | Playlist type is unviewable |
| 9bZkp7q19f0 | watch?v=ID&list=RDID | 12.075 | 25 | Works |
| 9bZkp7q19f0 | playlist?list=RDID | 10.745 | 0 | Playlist type is unviewable |

Both successful samples included id, title, channel/uploader, duration and URL,
plus thumbnails and live_status. live_status was null in the inspected entries,
which is not evidence of a live stream. Example Rick Astley mix entries included
Never Gonna Give You Up (214 s), CAN'T STOP THE FEELING! (286 s), I Feel It Coming
(298 s), Bad Dreams (185 s), and Flowers (202 s). The PSY mix included Gangnam
Style (253 s), APT. (174 s), Shake It Off (242 s), Sexy and I Know It (204 s), and
Axel F (172 s). These are songs, although recommendations are broad rather than
guaranteed genre matches. The seed itself appears and must be excluded by identity.

Twenty-five is the requested sample limit, not the full size of a radio playlist.
Production uses the working watch-Mix form, 30-minute caching and search fallback.
The two public seed videos were the only media URLs supplied to the diagnostic.
The throwaway script was deleted from the OS temp folder after completion.
